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
  profession: string | null;
  start_date: string | null;
  qualified_person: string | null;
  financial_status: string | null;
  welcome_message_sent: boolean | null;
  status: string;
  prospect_status: string | null;
  category: string | null;
  owner_id: string | null;
  sales_team_id: string | null;
  lead_score: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  website: string | null;
  preferred_language: string | null;
  pincode: string | null;
  zone_id: string | null;
  state_id: string | null;
  district_id: string | null;
  area_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  territory: string | null;
  company_name: string | null;
  source: string | null;
  inquiry_category: string | null;
  inquiry_source: string | null;
  capture_channel: string | null;
  utm_tags: string | null;
  campaign_id: string | null;
  expected_value: string | null;
  received_at: string | null;
  internal_notes: string | null;
  rm_remark: string | null;
  lg_remark: string | null;
  has_store_location: boolean | null;
  store_name: string | null;
  store_address: string | null;
  store_pincode: string | null;
  store_city: string | null;
  store_state: string | null;
  carpet_area: string | null;
  frontage: string | null;
  ownership: string | null;
  investment_capacity: string | null;
  existing_business: string | null;
  expected_opening: string | null;
  gst_number: string | null;
  pan_number: string | null;
  drug_licence_number: string | null;
  fssai_number: string | null;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  has_overdue_activity?: boolean;
}

export interface LeadConsentInput {
  captured?: boolean;
  method?: string;
  purposes?: string;
  evidenceRef?: string;
  notes?: string;
}

export interface CreateLeadInput {
  // Customer tab
  fullName: string;
  contactName?: string;
  profession?: string;
  startDate?: string;
  qualifiedPerson?: string;
  financialStatus?: string;
  welcomeMessageSent?: boolean;
  status?: string;
  prospectStatus?: string;
  category?: string;
  ownerId?: string;
  salesTeamId?: string;
  leadScore?: number;

  // Contact tab
  phone?: string;
  altPhone?: string;
  email?: string;
  website?: string;
  preferredLanguage?: string;
  pincode?: string;
  zoneId?: string;
  stateId?: string;
  districtId?: string;
  areaId?: string;
  addressLine1?: string;
  addressLine2?: string;
  territory?: string;

  // Inquiry tab
  companyName?: string;
  source?: string;
  inquiryCategory?: string;
  inquirySource?: string;
  captureChannel?: string;
  utmTags?: string;
  campaignId?: string;
  expectedValue?: number;
  receivedAt?: string;
  internalNotes?: string;
  rmRemark?: string;
  lgRemark?: string;

  // Store tab
  hasStoreLocation?: boolean;
  storeName?: string;
  storeAddress?: string;
  storePincode?: string;
  storeCity?: string;
  storeState?: string;
  carpetArea?: string;
  frontage?: string;
  ownership?: string;
  investmentCapacity?: number;
  existingBusiness?: string;
  expectedOpening?: string;
  gstNumber?: string;
  panNumber?: string;
  drugLicenceNumber?: string;
  fssaiNumber?: string;

  // Consent tab
  consent?: LeadConsentInput;
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
    profession: row.profession,
    startDate: row.start_date,
    qualifiedPerson: row.qualified_person,
    financialStatus: row.financial_status,
    welcomeMessageSent: row.welcome_message_sent,
    status: row.status,
    prospectStatus: row.prospect_status,
    category: row.category,
    ownerId: row.owner_id,
    salesTeamId: row.sales_team_id,
    leadScore: row.lead_score === null ? null : Number(row.lead_score),
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    website: row.website,
    preferredLanguage: row.preferred_language,
    pincode: row.pincode,
    zoneId: row.zone_id,
    stateId: row.state_id,
    districtId: row.district_id,
    areaId: row.area_id,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    territory: row.territory,
    companyName: row.company_name,
    source: row.source,
    inquiryCategory: row.inquiry_category,
    inquirySource: row.inquiry_source,
    captureChannel: row.capture_channel,
    utmTags: row.utm_tags,
    campaignId: row.campaign_id,
    expectedValue: row.expected_value === null ? null : Number(row.expected_value),
    receivedAt: row.received_at,
    internalNotes: row.internal_notes,
    rmRemark: row.rm_remark,
    lgRemark: row.lg_remark,
    hasStoreLocation: row.has_store_location,
    storeName: row.store_name,
    storeAddress: row.store_address,
    storePincode: row.store_pincode,
    storeCity: row.store_city,
    storeState: row.store_state,
    carpetArea: row.carpet_area,
    frontage: row.frontage,
    ownership: row.ownership,
    investmentCapacity: row.investment_capacity === null ? null : Number(row.investment_capacity),
    existingBusiness: row.existing_business,
    expectedOpening: row.expected_opening,
    gstNumber: row.gst_number,
    panNumber: row.pan_number,
    drugLicenceNumber: row.drug_licence_number,
    fssaiNumber: row.fssai_number,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerName: row.owner_name,
    hasOverdueActivity: row.has_overdue_activity ?? undefined,
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

// Builds column/placeholder/value triples from a { column: value } map,
// skipping any key whose value is undefined - avoids manual $N counting,
// which is easy to get wrong on a wide table like this one.
function buildInsert(fieldMap: Record<string, unknown>): { columns: string[]; placeholders: string[]; values: unknown[] } {
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];

  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      columns.push(column);
      values.push(value);
      placeholders.push(`$${values.length}`);
    }
  }

  return { columns, placeholders, values };
}

export async function createLead(input: CreateLeadInput, creatorId: string) {
  const ownerId = input.ownerId ?? creatorId;

  const { columns, placeholders, values } = buildInsert({
    full_name: input.fullName,
    contact_name: input.contactName,
    profession: input.profession,
    start_date: input.startDate,
    qualified_person: input.qualifiedPerson,
    financial_status: input.financialStatus,
    welcome_message_sent: input.welcomeMessageSent,
    status: input.status ?? "new",
    prospect_status: input.prospectStatus,
    category: input.category,
    owner_id: ownerId,
    sales_team_id: input.salesTeamId,
    lead_score: input.leadScore,
    phone: input.phone,
    alt_phone: input.altPhone,
    email: input.email,
    website: input.website,
    preferred_language: input.preferredLanguage,
    pincode: input.pincode,
    zone_id: input.zoneId,
    state_id: input.stateId,
    district_id: input.districtId,
    area_id: input.areaId,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2,
    territory: input.territory,
    company_name: input.companyName,
    source: input.source,
    inquiry_category: input.inquiryCategory,
    inquiry_source: input.inquirySource,
    capture_channel: input.captureChannel,
    utm_tags: input.utmTags,
    campaign_id: input.campaignId,
    expected_value: input.expectedValue,
    received_at: input.receivedAt,
    internal_notes: input.internalNotes,
    rm_remark: input.rmRemark,
    lg_remark: input.lgRemark,
    has_store_location: input.hasStoreLocation,
    store_name: input.storeName,
    store_address: input.storeAddress,
    store_pincode: input.storePincode,
    store_city: input.storeCity,
    store_state: input.storeState,
    carpet_area: input.carpetArea,
    frontage: input.frontage,
    ownership: input.ownership,
    investment_capacity: input.investmentCapacity,
    existing_business: input.existingBusiness,
    expected_opening: input.expectedOpening,
    gst_number: input.gstNumber,
    pan_number: input.panNumber,
    drug_licence_number: input.drugLicenceNumber,
    fssai_number: input.fssaiNumber,
    created_by: creatorId,
    updated_by: creatorId,
  });

  const result = await pool.query<LeadRow>(
    `INSERT INTO leads (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    values
  );

  const lead = result.rows[0];

  if (input.consent) {
    const captured = input.consent.captured ?? false;
    await pool.query(
      `INSERT INTO consents (lead_id, captured, method, purposes, evidence_ref, notes, captured_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        lead.id,
        captured,
        input.consent.method ?? null,
        input.consent.purposes ?? null,
        input.consent.evidenceRef ?? null,
        input.consent.notes ?? null,
        captured ? new Date() : null,
        captured ? "captured" : "pending",
      ]
    );
  }

  return toPublicLead(lead);
}

export async function getLeadById(leadId: string, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query<LeadRow>(
    `SELECT l.*, u.name AS owner_name FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.id = $1 AND l.is_deleted = false`,
    [leadId]
  );
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
     SELECT l.*, u.name AS owner_name,
       EXISTS (
         SELECT 1 FROM activities a
         WHERE a.lead_id = l.id AND a.due_date < now() AND a.status <> 'completed'
       ) AS has_overdue_activity
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
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
    profession: updates.profession,
    start_date: updates.startDate,
    qualified_person: updates.qualifiedPerson,
    financial_status: updates.financialStatus,
    welcome_message_sent: updates.welcomeMessageSent,
    status: updates.status,
    prospect_status: updates.prospectStatus,
    category: updates.category,
    owner_id: updates.ownerId,
    sales_team_id: updates.salesTeamId,
    lead_score: updates.leadScore,
    phone: updates.phone,
    alt_phone: updates.altPhone,
    email: updates.email,
    website: updates.website,
    preferred_language: updates.preferredLanguage,
    pincode: updates.pincode,
    zone_id: updates.zoneId,
    state_id: updates.stateId,
    district_id: updates.districtId,
    area_id: updates.areaId,
    address_line1: updates.addressLine1,
    address_line2: updates.addressLine2,
    territory: updates.territory,
    company_name: updates.companyName,
    source: updates.source,
    inquiry_category: updates.inquiryCategory,
    inquiry_source: updates.inquirySource,
    capture_channel: updates.captureChannel,
    utm_tags: updates.utmTags,
    campaign_id: updates.campaignId,
    expected_value: updates.expectedValue,
    received_at: updates.receivedAt,
    internal_notes: updates.internalNotes,
    rm_remark: updates.rmRemark,
    lg_remark: updates.lgRemark,
    has_store_location: updates.hasStoreLocation,
    store_name: updates.storeName,
    store_address: updates.storeAddress,
    store_pincode: updates.storePincode,
    store_city: updates.storeCity,
    store_state: updates.storeState,
    carpet_area: updates.carpetArea,
    frontage: updates.frontage,
    ownership: updates.ownership,
    investment_capacity: updates.investmentCapacity,
    existing_business: updates.existingBusiness,
    expected_opening: updates.expectedOpening,
    gst_number: updates.gstNumber,
    pan_number: updates.panNumber,
    drug_licence_number: updates.drugLicenceNumber,
    fssai_number: updates.fssaiNumber,
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

export async function getLeadConsent(leadId: string, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query(
    `SELECT id, captured, method, purposes, evidence_ref AS "evidenceRef", notes, status, captured_at AS "capturedAt"
     FROM consents WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  );

  return result.rows[0] ?? null;
}
