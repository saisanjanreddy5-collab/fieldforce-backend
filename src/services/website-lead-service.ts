import crypto from "crypto";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import * as leadService from "./lead-service";

interface WebsiteSourceRow {
  id: string;
  name: string;
  api_key: string | null;
  allowed_origin: string | null;
  default_category: string | null;
  default_owner_id: string | null;
  utm_tags: string | null;
  require_consent: boolean;
  status: "active" | "paused";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceQueryRow extends WebsiteSourceRow {
  default_owner_name: string | null;
  created_by_name: string | null;
  leads_count: string;
  consented_count: string;
}

function toPublicSource(row: SourceQueryRow) {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    allowedOrigin: row.allowed_origin,
    defaultCategory: row.default_category,
    defaultOwnerId: row.default_owner_id,
    defaultOwnerName: row.default_owner_name,
    utmTags: row.utm_tags,
    requireConsent: row.require_consent,
    status: row.status,
    leadsCount: Number(row.leads_count),
    consentedCount: Number(row.consented_count),
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

// Same real table QR lead capture already extended - this is the second
// real consumer of `campaigns`, discriminated by source_type. A website
// source's leads join through the same campaign_id FK, so Reports > Lead
// source ROI already attributes them correctly without any extra work.
const SOURCE_SELECT = `
  SELECT c.*, uo.name AS default_owner_name, uc.name AS created_by_name,
    COUNT(DISTINCT l.id) AS leads_count,
    COUNT(DISTINCT l.id) FILTER (WHERE co.captured = true) AS consented_count
  FROM campaigns c
  LEFT JOIN users uo ON uo.id = c.default_owner_id
  LEFT JOIN users uc ON uc.id = c.created_by
  LEFT JOIN leads l ON l.campaign_id = c.id AND l.is_deleted = false
  LEFT JOIN consents co ON co.lead_id = l.id
  WHERE c.source_type = 'website'
`;

// Deliberately not the friendly short `code` QR uses (that one is meant to
// be public, embedded in a printed image). This is a bearer credential an
// external website's own code holds and calls our API with, so it has to
// stay a genuine secret - long and unguessable.
function generateApiKey(): string {
  return crypto.randomBytes(24).toString("hex");
}

export interface ListWebsiteLeadSourcesFilters {
  page: number;
  limit: number;
}

export async function listWebsiteLeadSources(filters: ListWebsiteLeadSourcesFilters) {
  const countResult = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM campaigns c WHERE c.source_type = 'website'"
  );

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const result = await pool.query<SourceQueryRow>(
    `${SOURCE_SELECT} GROUP BY c.id, uo.name, uc.name ORDER BY c.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { websiteLeadSources: result.rows.map(toPublicSource), total: Number(countResult.rows[0].count) };
}

async function getSourceById(id: string) {
  const result = await pool.query<SourceQueryRow>(`${SOURCE_SELECT} AND c.id = $1 GROUP BY c.id, uo.name, uc.name`, [id]);
  if (result.rows.length === 0) throw new ApiError(404, "Website lead source not found");
  return result.rows[0];
}

export interface UpsertWebsiteLeadSourceInput {
  name: string;
  allowedOrigin?: string | null;
  defaultCategory: string;
  defaultOwnerId?: string | null;
  utmTags?: string | null;
  requireConsent?: boolean;
}

export async function createWebsiteLeadSource(input: UpsertWebsiteLeadSourceInput, creatorId: string) {
  const apiKey = generateApiKey();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (name, source_type, api_key, allowed_origin, default_category, default_owner_id, utm_tags, require_consent, created_by)
     VALUES ($1,'website',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      input.name,
      apiKey,
      input.allowedOrigin?.trim() || null,
      input.defaultCategory,
      input.defaultOwnerId ?? null,
      input.utmTags ?? null,
      input.requireConsent ?? true,
      creatorId,
    ]
  );
  return toPublicSource(await getSourceById(inserted.rows[0].id));
}

export interface UpdateWebsiteLeadSourceInput extends Partial<UpsertWebsiteLeadSourceInput> {
  status?: "active" | "paused";
}

export async function updateWebsiteLeadSource(id: string, updates: UpdateWebsiteLeadSourceInput) {
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    allowed_origin: updates.allowedOrigin,
    default_category: updates.defaultCategory,
    default_owner_id: updates.defaultOwnerId,
    utm_tags: updates.utmTags,
    require_consent: updates.requireConsent,
    status: updates.status,
  };

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = now()");
    params.push(id);
    const result = await pool.query(
      `UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = $${params.length} AND source_type = 'website'`,
      params
    );
    if ((result.rowCount ?? 0) === 0) throw new ApiError(404, "Website lead source not found");
  }

  return toPublicSource(await getSourceById(id));
}

// ---- Public, unauthenticated surface (called by the client's own website) ----

async function findSourceByApiKey(apiKey: string): Promise<WebsiteSourceRow | null> {
  const result = await pool.query<WebsiteSourceRow>(
    `SELECT * FROM campaigns WHERE api_key = $1 AND source_type = 'website'`,
    [apiKey]
  );
  return result.rows[0] ?? null;
}

export interface PublicWebsiteSubmitInput {
  fullName: string;
  phone: string;
  email?: string;
  message?: string;
  cityOrPincode?: string;
  consentGranted?: boolean;
}

export async function submitWebsiteLead(apiKey: string, input: PublicWebsiteSubmitInput, ipAddress?: string | null) {
  const row = await findSourceByApiKey(apiKey);
  if (!row) throw new ApiError(404, "This submission key isn't recognized");
  if (row.status === "paused") throw new ApiError(422, "This source isn't accepting submissions right now");

  if (!input.fullName?.trim()) throw new ApiError(422, "Name is required");
  if (!input.phone?.trim()) throw new ApiError(422, "Phone is required");
  if (row.require_consent && !input.consentGranted) {
    throw new ApiError(422, "Consent is required to submit this form");
  }
  if (!row.created_by) {
    throw new ApiError(500, "This source has no owner on record and can't accept submissions");
  }

  const lead = await leadService.createLead(
    {
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email?.trim() || undefined,
      addressLine1: input.cityOrPincode?.trim() || undefined,
      internalNotes: input.message?.trim() || undefined,
      category: row.default_category ?? undefined,
      source: "website",
      inquirySource: `Website — ${row.name}`,
      captureChannel: "website",
      utmTags: row.utm_tags ?? undefined,
      campaignId: row.id,
      ownerId: row.default_owner_id ?? undefined,
      consent: {
        captured: !!input.consentGranted,
        method: "website_form",
        purposes: `Contact regarding this enquiry — ${row.name} (DPDP)`,
      },
    },
    row.created_by,
    ipAddress
  );

  return { leadNumber: lead.leadNumber };
}
