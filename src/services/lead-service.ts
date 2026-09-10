import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

// Rule A (hierarchy-based visibility): a lead is visible to its owner and to
// everyone directly above the owner in the reporting chain. Walking UP from a
// specific lead's owner would need one query per lead, so instead we walk
// DOWN from the requesting user to find their entire subtree (themselves +
// every direct/indirect report). A lead is then visible via Rule A exactly
// when its owner is somewhere in that subtree - which is equivalent to "the
// requesting user is on the owner's upward chain".
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

interface LeadRow {
  id: string;
  full_name: string;
  contact_name: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  website: string | null;
  preferred_language: string | null;
  company_name: string | null;
  profession: string | null;
  category: string | null;
  source: string | null;
  inquiry_category: string | null;
  inquiry_source: string | null;
  capture_channel: string | null;
  utm_tags: string | null;
  campaign_id: string | null;
  expected_value: string | null;
  status: string;
  prospect_status: string | null;
  owner_id: string | null;
  sales_team_id: string | null;
  zone_id: string | null;
  state_id: string | null;
  district_id: string | null;
  area_id: string | null;
  pincode: string | null;
  address_line1: string | null;
  address_line2: string | null;
  territory: string | null;
  internal_notes: string | null;
  rm_remark: string | null;
  lg_remark: string | null;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLeadInput {
  fullName: string;
  contactName?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  website?: string;
  preferredLanguage?: string;
  companyName?: string;
  profession?: string;
  category?: string;
  source?: string;
  inquiryCategory?: string;
  inquirySource?: string;
  captureChannel?: string;
  utmTags?: string;
  campaignId?: string;
  expectedValue?: number;
  status?: string;
  prospectStatus?: string;
  ownerId?: string;
  salesTeamId?: string;
  zoneId?: string;
  stateId?: string;
  districtId?: string;
  areaId?: string;
  pincode?: string;
  addressLine1?: string;
  addressLine2?: string;
  territory?: string;
  internalNotes?: string;
  rmRemark?: string;
  lgRemark?: string;
}

export interface ListLeadsFilters {
  status?: string;
  ownerId?: string;
  zoneId?: string;
  stateId?: string;
  districtId?: string;
  areaId?: string;
  search?: string;
  page: number;
  limit: number;
}

function toPublicLead(row: LeadRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    contactName: row.contact_name,
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    website: row.website,
    preferredLanguage: row.preferred_language,
    companyName: row.company_name,
    profession: row.profession,
    category: row.category,
    source: row.source,
    inquiryCategory: row.inquiry_category,
    inquirySource: row.inquiry_source,
    captureChannel: row.capture_channel,
    utmTags: row.utm_tags,
    campaignId: row.campaign_id,
    expectedValue: row.expected_value === null ? null : Number(row.expected_value),
    status: row.status,
    prospectStatus: row.prospect_status,
    ownerId: row.owner_id,
    salesTeamId: row.sales_team_id,
    zoneId: row.zone_id,
    stateId: row.state_id,
    districtId: row.district_id,
    areaId: row.area_id,
    pincode: row.pincode,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    territory: row.territory,
    internalNotes: row.internal_notes,
    rmRemark: row.rm_remark,
    lgRemark: row.lg_remark,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function isLeadVisibleToUser(leadId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM leads l
     WHERE l.id = $2
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
       )`,
    [userId, leadId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createLead(input: CreateLeadInput, creatorId: string) {
  const ownerId = input.ownerId ?? creatorId;

  const result = await pool.query<LeadRow>(
    `INSERT INTO leads (
       full_name, contact_name, phone, alt_phone, email, website, preferred_language,
       company_name, profession, category, source, inquiry_category, inquiry_source,
       capture_channel, utm_tags, campaign_id, expected_value, status, prospect_status,
       owner_id, sales_team_id, zone_id, state_id, district_id, area_id, pincode,
       address_line1, address_line2, territory, internal_notes, rm_remark, lg_remark,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       COALESCE($18, 'new'),$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$33
     )
     RETURNING *`,
    [
      input.fullName,
      input.contactName ?? null,
      input.phone ?? null,
      input.altPhone ?? null,
      input.email ?? null,
      input.website ?? null,
      input.preferredLanguage ?? null,
      input.companyName ?? null,
      input.profession ?? null,
      input.category ?? null,
      input.source ?? null,
      input.inquiryCategory ?? null,
      input.inquirySource ?? null,
      input.captureChannel ?? null,
      input.utmTags ?? null,
      input.campaignId ?? null,
      input.expectedValue ?? null,
      input.status ?? null,
      input.prospectStatus ?? null,
      ownerId,
      input.salesTeamId ?? null,
      input.zoneId ?? null,
      input.stateId ?? null,
      input.districtId ?? null,
      input.areaId ?? null,
      input.pincode ?? null,
      input.addressLine1 ?? null,
      input.addressLine2 ?? null,
      input.territory ?? null,
      input.internalNotes ?? null,
      input.rmRemark ?? null,
      input.lgRemark ?? null,
      creatorId,
    ]
  );

  return toPublicLead(result.rows[0]);
}

export async function getLeadById(leadId: string, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query<LeadRow>("SELECT * FROM leads WHERE id = $1 AND is_deleted = false", [leadId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Lead not found");
  }

  return toPublicLead(result.rows[0]);
}

export async function listLeadsForUser(requestingUserId: string, filters: ListLeadsFilters) {
  const conditions: string[] = ["l.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(`(
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
  )`);

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (filters.ownerId) {
    params.push(filters.ownerId);
    conditions.push(`l.owner_id = $${params.length}`);
  }
  if (filters.zoneId) {
    params.push(filters.zoneId);
    conditions.push(`l.zone_id = $${params.length}`);
  }
  if (filters.stateId) {
    params.push(filters.stateId);
    conditions.push(`l.state_id = $${params.length}`);
  }
  if (filters.districtId) {
    params.push(filters.districtId);
    conditions.push(`l.district_id = $${params.length}`);
  }
  if (filters.areaId) {
    params.push(filters.areaId);
    conditions.push(`l.area_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const idx = params.length;
    conditions.push(`(l.full_name ILIKE $${idx} OR l.company_name ILIKE $${idx} OR l.phone ILIKE $${idx})`);
  }

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;
  params.push(limit, offset);

  const result = await pool.query<LeadRow>(
    `${SUBTREE_CTE}
     SELECT l.* FROM leads l
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows.map(toPublicLead);
}

export async function updateLead(leadId: string, updates: Partial<CreateLeadInput>, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const fieldMap: Record<string, unknown> = {
    full_name: updates.fullName,
    contact_name: updates.contactName,
    phone: updates.phone,
    alt_phone: updates.altPhone,
    email: updates.email,
    website: updates.website,
    preferred_language: updates.preferredLanguage,
    company_name: updates.companyName,
    profession: updates.profession,
    category: updates.category,
    source: updates.source,
    inquiry_category: updates.inquiryCategory,
    inquiry_source: updates.inquirySource,
    capture_channel: updates.captureChannel,
    utm_tags: updates.utmTags,
    campaign_id: updates.campaignId,
    expected_value: updates.expectedValue,
    status: updates.status,
    prospect_status: updates.prospectStatus,
    owner_id: updates.ownerId,
    sales_team_id: updates.salesTeamId,
    zone_id: updates.zoneId,
    state_id: updates.stateId,
    district_id: updates.districtId,
    area_id: updates.areaId,
    pincode: updates.pincode,
    address_line1: updates.addressLine1,
    address_line2: updates.addressLine2,
    territory: updates.territory,
    internal_notes: updates.internalNotes,
    rm_remark: updates.rmRemark,
    lg_remark: updates.lgRemark,
  };

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) {
    return getLeadById(leadId, requestingUserId);
  }

  params.push(requestingUserId);
  setClauses.push(`updated_by = $${params.length}`);
  params.push(new Date());
  setClauses.push(`updated_at = $${params.length}`);

  params.push(leadId);

  const result = await pool.query<LeadRow>(
    `UPDATE leads SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return toPublicLead(result.rows[0]);
}

export async function deleteLead(leadId: string, requestingUserId: string): Promise<void> {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  await pool.query(
    "UPDATE leads SET is_deleted = true, updated_by = $1, updated_at = now() WHERE id = $2",
    [requestingUserId, leadId]
  );
}

export async function shareLead(leadId: string, targetUserId: string, sharedByUserId: string): Promise<void> {
  const visible = await isLeadVisibleToUser(leadId, sharedByUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  await pool.query(
    `INSERT INTO lead_shares (lead_id, shared_with_user_id, shared_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (lead_id, shared_with_user_id) DO NOTHING`,
    [leadId, targetUserId, sharedByUserId]
  );
}

export async function unshareLead(leadId: string, targetUserId: string, requestingUserId: string): Promise<void> {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  await pool.query("DELETE FROM lead_shares WHERE lead_id = $1 AND shared_with_user_id = $2", [leadId, targetUserId]);
}

export async function listLeadShares(leadId: string, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query(
    `SELECT ls.shared_with_user_id AS "userId", u.name, u.email, ls.created_at AS "sharedAt"
     FROM lead_shares ls
     JOIN users u ON u.id = ls.shared_with_user_id
     WHERE ls.lead_id = $1`,
    [leadId]
  );

  return result.rows;
}
