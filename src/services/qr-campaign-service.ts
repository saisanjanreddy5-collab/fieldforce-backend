import geoip from "geoip-lite";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import * as leadService from "./lead-service";
import * as leadCategoryService from "./lead-category-service";
import * as leadDocumentService from "./lead-document-service";

interface CampaignRow {
  id: string;
  name: string;
  code: string | null;
  placement: string | null;
  default_category: string | null;
  default_owner_id: string | null;
  utm_tags: string | null;
  expires_at: string | null;
  require_consent: boolean;
  capture_scan_location: boolean;
  field_config: QrFieldConfig;
  status: "active" | "paused";
  scan_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QrFieldConfig {
  email?: boolean;
  investmentCapacity?: boolean;
  existingStore?: boolean;
  preferredLanguage?: boolean;
  photo?: boolean;
}

function isExpired(row: CampaignRow): boolean {
  return row.expires_at !== null && new Date(row.expires_at).getTime() < Date.now();
}

function toPublicCampaign(row: CampaignRow, extra: { defaultOwnerName: string | null; createdByName: string | null; leadsCount: number; consentedCount: number }) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    placement: row.placement,
    defaultCategory: row.default_category,
    defaultOwnerId: row.default_owner_id,
    defaultOwnerName: extra.defaultOwnerName,
    utmTags: row.utm_tags,
    expiresAt: row.expires_at,
    requireConsent: row.require_consent,
    captureScanLocation: row.capture_scan_location,
    fieldConfig: row.field_config ?? {},
    status: isExpired(row) ? "paused" : row.status,
    isExpired: isExpired(row),
    scanCount: row.scan_count,
    leadsCount: extra.leadsCount,
    conversionRate: row.scan_count > 0 ? Math.round((extra.leadsCount / row.scan_count) * 1000) / 10 : null,
    consentedCount: extra.consentedCount,
    createdByName: extra.createdByName,
    createdAt: row.created_at,
  };
}

const CAMPAIGN_SELECT = `
  SELECT c.*, uo.name AS default_owner_name, uc.name AS created_by_name,
    COUNT(DISTINCT l.id) AS leads_count,
    COUNT(DISTINCT l.id) FILTER (WHERE co.captured = true) AS consented_count
  FROM campaigns c
  LEFT JOIN users uo ON uo.id = c.default_owner_id
  LEFT JOIN users uc ON uc.id = c.created_by
  LEFT JOIN leads l ON l.campaign_id = c.id AND l.is_deleted = false
  LEFT JOIN consents co ON co.lead_id = l.id
  WHERE c.code IS NOT NULL
`;

interface CampaignQueryRow extends CampaignRow {
  default_owner_name: string | null;
  created_by_name: string | null;
  leads_count: string;
  consented_count: string;
}

function mapQueryRow(row: CampaignQueryRow) {
  return toPublicCampaign(row, {
    defaultOwnerName: row.default_owner_name,
    createdByName: row.created_by_name,
    leadsCount: Number(row.leads_count),
    consentedCount: Number(row.consented_count),
  });
}

export interface ListCampaignsFilters {
  page: number;
  limit: number;
}

export async function listCampaigns(filters: ListCampaignsFilters) {
  const countResult = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM campaigns c WHERE c.code IS NOT NULL"
  );

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const result = await pool.query<CampaignQueryRow>(
    `${CAMPAIGN_SELECT} GROUP BY c.id, uo.name, uc.name ORDER BY c.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { qrCampaigns: result.rows.map(mapQueryRow), total: Number(countResult.rows[0].count) };
}

export async function getSummaryStats() {
  const campaignsResult = await pool.query<{ active_count: string; total_count: string; total_scans: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS active_count,
       COUNT(*) AS total_count,
       COALESCE(SUM(scan_count), 0) AS total_scans
     FROM campaigns WHERE code IS NOT NULL`
  );
  const leadsResult = await pool.query<{ leads_count: string; consented_count: string }>(
    `SELECT COUNT(l.id) AS leads_count, COUNT(l.id) FILTER (WHERE co.captured = true) AS consented_count
     FROM leads l
     JOIN campaigns c ON c.id = l.campaign_id
     LEFT JOIN consents co ON co.lead_id = l.id
     WHERE c.code IS NOT NULL AND l.is_deleted = false`
  );

  const c = campaignsResult.rows[0];
  const l = leadsResult.rows[0];
  const totalScans = Number(c.total_scans);
  const leadsCount = Number(l.leads_count);
  const consentedCount = Number(l.consented_count);

  return {
    activeCount: Number(c.active_count),
    totalCount: Number(c.total_count),
    totalScans,
    leadsCount,
    conversionRate: totalScans > 0 ? Math.round((leadsCount / totalScans) * 1000) / 10 : null,
    consentRate: leadsCount > 0 ? Math.round((consentedCount / leadsCount) * 1000) / 10 : null,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "campaign";
}

async function generateUniqueCode(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    const existing = await pool.query("SELECT 1 FROM campaigns WHERE code = $1", [candidate]);
    if ((existing.rowCount ?? 0) === 0) return candidate;
  }
  throw new ApiError(500, "Could not generate a unique QR code, please try again");
}

export interface UpsertQrCampaignInput {
  name: string;
  placement?: string | null;
  defaultCategory: string;
  defaultOwnerId?: string | null;
  utmTags?: string | null;
  expiresAt?: string | null;
  requireConsent?: boolean;
  captureScanLocation?: boolean;
  fieldConfig?: QrFieldConfig;
}

async function getCampaignById(id: string): Promise<{ leadsCount: number; consentedCount: number } & CampaignQueryRow> {
  const result = await pool.query<CampaignQueryRow>(`${CAMPAIGN_SELECT} AND c.id = $1 GROUP BY c.id, uo.name, uc.name`, [id]);
  if (result.rows.length === 0) throw new ApiError(404, "QR campaign not found");
  return result.rows[0] as CampaignQueryRow & { leadsCount: number; consentedCount: number };
}

export async function createCampaign(input: UpsertQrCampaignInput, creatorId: string) {
  const code = await generateUniqueCode(input.name);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (name, code, placement, default_category, default_owner_id, utm_tags, expires_at, require_consent, capture_scan_location, field_config, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      input.name,
      code,
      input.placement ?? null,
      input.defaultCategory,
      input.defaultOwnerId ?? null,
      input.utmTags ?? null,
      input.expiresAt ?? null,
      input.requireConsent ?? true,
      input.captureScanLocation ?? true,
      JSON.stringify(input.fieldConfig ?? {}),
      creatorId,
    ]
  );
  return mapQueryRow(await getCampaignById(inserted.rows[0].id));
}

export interface UpdateQrCampaignInput extends Partial<UpsertQrCampaignInput> {
  status?: "active" | "paused";
}

export async function updateCampaign(id: string, updates: UpdateQrCampaignInput) {
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    placement: updates.placement,
    default_category: updates.defaultCategory,
    default_owner_id: updates.defaultOwnerId,
    utm_tags: updates.utmTags,
    expires_at: updates.expiresAt,
    require_consent: updates.requireConsent,
    capture_scan_location: updates.captureScanLocation,
    field_config: updates.fieldConfig !== undefined ? JSON.stringify(updates.fieldConfig) : undefined,
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
    const result = await pool.query(`UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
    if ((result.rowCount ?? 0) === 0) throw new ApiError(404, "QR campaign not found");
  }

  return mapQueryRow(await getCampaignById(id));
}

// ---- Public, unauthenticated surface (the actual scanned page) ----

export interface PublicCampaignInfo {
  active: boolean;
  reason?: "not_found" | "paused" | "expired";
  name?: string;
  fieldConfig?: QrFieldConfig;
  requireConsent?: boolean;
  categoryLabel?: string | null;
  resolvedCity?: string | null;
}

async function findCampaignByCode(code: string): Promise<CampaignRow | null> {
  const result = await pool.query<CampaignRow>("SELECT * FROM campaigns WHERE code = $1", [code]);
  return result.rows[0] ?? null;
}

// Real IP geolocation via a bundled offline database (geoip-lite) - no
// external API call, no key, and it only ever prefills the visible city
// field, never a hidden/structured location the visitor can't see or edit.
// In local dev, requests come from a private/loopback IP so this genuinely
// resolves to nothing, same as it would for any real GeoIP feature.
function resolveScanCity(ip: string): string | null {
  const geo = geoip.lookup(ip);
  if (!geo) return null;
  return [geo.city, geo.region].filter(Boolean).join(", ") || geo.country || null;
}

export async function getPublicCampaignInfo(code: string, ip: string): Promise<PublicCampaignInfo> {
  const row = await findCampaignByCode(code);
  if (!row) return { active: false, reason: "not_found" };
  if (row.status === "paused") return { active: false, reason: "paused", name: row.name };
  if (isExpired(row)) return { active: false, reason: "expired", name: row.name };

  await pool.query("UPDATE campaigns SET scan_count = scan_count + 1 WHERE id = $1", [row.id]);

  const categories = await leadCategoryService.listLeadCategories();
  const categoryLabel = categories.find((c) => c.key === row.default_category)?.label ?? row.default_category;

  return {
    active: true,
    name: row.name,
    fieldConfig: row.field_config ?? {},
    requireConsent: row.require_consent,
    categoryLabel,
    resolvedCity: row.capture_scan_location ? resolveScanCity(ip) : null,
  };
}

export interface PublicSubmitInput {
  fullName: string;
  phone: string;
  cityOrPincode: string;
  email?: string;
  investmentCapacity?: number;
  existingStore?: boolean;
  preferredLanguage?: string;
  consentGranted: boolean;
}

export async function submitPublicCapture(
  code: string,
  input: PublicSubmitInput,
  photo: { file: Express.Multer.File } | undefined,
  ipAddress?: string | null
) {
  const row = await findCampaignByCode(code);
  if (!row) throw new ApiError(404, "This QR code isn't recognized");
  if (row.status === "paused") throw new ApiError(422, "This code isn't accepting submissions right now");
  if (isExpired(row)) throw new ApiError(422, "This code has expired");

  if (!input.fullName?.trim()) throw new ApiError(422, "Name is required");
  if (!input.phone?.trim()) throw new ApiError(422, "Mobile number is required");
  if (!input.cityOrPincode?.trim()) throw new ApiError(422, "City / pin code is required");
  if (row.require_consent && !input.consentGranted) {
    throw new ApiError(422, "Consent is required to submit this form");
  }
  if (!row.created_by) {
    throw new ApiError(500, "This campaign has no owner on record and can't accept submissions");
  }
  const creatorId = row.created_by;

  const fieldConfig = row.field_config ?? {};
  const lead = await leadService.createLead(
    {
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: fieldConfig.email ? input.email?.trim() || undefined : undefined,
      addressLine1: input.cityOrPincode.trim(),
      category: row.default_category ?? undefined,
      investmentCapacity: fieldConfig.investmentCapacity ? input.investmentCapacity : undefined,
      existingBusiness: fieldConfig.existingStore && input.existingStore ? "Yes" : undefined,
      preferredLanguage: fieldConfig.preferredLanguage ? input.preferredLanguage?.trim() || undefined : undefined,
      source: "qr",
      inquirySource: `QR code — ${row.name}`,
      captureChannel: "qr",
      utmTags: row.utm_tags ?? undefined,
      campaignId: row.id,
      ownerId: row.default_owner_id ?? undefined,
      consent: {
        captured: input.consentGranted,
        method: "qr_capture_form",
        purposes: "Contact regarding this enquiry (DPDP)",
      },
    },
    creatorId,
    ipAddress
  );

  if (fieldConfig.photo && photo?.file) {
    await leadDocumentService.saveUploadedFile(lead.id, "shop_photos", photo.file, creatorId);
  }

  return { leadNumber: lead.leadNumber };
}
