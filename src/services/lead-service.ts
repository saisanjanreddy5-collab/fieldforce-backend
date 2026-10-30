import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { recordAuditEvent, listAuditLogForEntity } from "./audit-log-service";
import { bulkImportRowSchema } from "../validators/lead-validator";
import { createCustomerFromLead, syncCustomerOwnerFromLead } from "./customer-service";
import { listActivitiesForLead, listCommentsForActivities } from "./activity-service";

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
  lead_number: number | null;
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
  entity_type: string | null;
  aadhaar_number: string | null;
  nearest_coco_store: string | null;
  signage_status: string | null;
  security_deposit: string | null;
  opening_stock: string | null;
  margin_slab: string | null;
  credit_limit_requested: string | null;
  credit_category: string | null;
  payment_terms: string | null;
  target_go_live: string | null;
  push_status: string;
  onboarding_app_id: string | null;
  pushed_at: string | null;
  call_attempt_count: number;
  last_call_outcome: string | null;
  last_call_at: string | null;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  // Which security tier currently owns this lead - the only reliable way
  // the frontend can tell "already with Field Sales" apart from "still with
  // Call Center" (sendToField deliberately never changes status - see
  // lead-call-center-service.ts), so it can hide an action that would
  // otherwise just 422.
  owner_role: string | null;
  // Set once at creation/edit time when this lead's phone matched an
  // already-active lead (see resolveDuplicateOfLeadId) - the name/number are
  // only joined by the handful of call sites that already bother joining
  // owner_name/owner_role (getLeadById, listLeadsForUser,
  // listLeadsHandedOffByUser), same precedent updateLead's plain
  // `RETURNING *` already follows for owner_name itself.
  duplicate_of_lead_id: string | null;
  duplicate_of_full_name?: string | null;
  duplicate_of_lead_number?: number | null;
  // Mirrors isLeadInOwnerScope - true when this user can actually act on the
  // lead (Call/Email/Teams/WhatsApp/Edit/Qualify/etc.), false when they can
  // only look at it (e.g. a Call Center rep's read-only lead_shares grant
  // after handing it to Field Sales - see shareLeadBackToSender). Always
  // present (both getLeadById and listLeadsForUser select it), never
  // optional like the two below.
  in_owner_scope: boolean;
  has_overdue_activity?: boolean;
  next_activity_due_at?: string | null;
  consent_pending?: boolean;
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

  // FOFO onboarding handoff
  entityType?: string;
  aadhaarNumber?: string;
  nearestCocoStore?: string;
  signageStatus?: string;
  securityDeposit?: number;
  openingStock?: number;
  marginSlab?: string;
  creditLimitRequested?: number;
  creditCategory?: string;
  paymentTerms?: string;
  targetGoLive?: string;

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
  category?: string;
  source?: string;
  overdueOnly?: boolean;
  highScoreOnly?: boolean;
  consentPending?: boolean;
  unassignedOnly?: boolean;
  page: number;
  limit: number;
}

// Same "good score" threshold already established for the green tier in
// utils/lead-format.ts's scoreColor on the frontend - reused here rather
// than inventing a second, different number for the same concept.
const HIGH_SCORE_THRESHOLD = 70;

function toPublicLead(row: LeadRow) {
  return {
    id: row.id,
    leadNumber: row.lead_number,
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
    entityType: row.entity_type,
    aadhaarNumber: row.aadhaar_number,
    nearestCocoStore: row.nearest_coco_store,
    signageStatus: row.signage_status,
    securityDeposit: row.security_deposit === null ? null : Number(row.security_deposit),
    openingStock: row.opening_stock === null ? null : Number(row.opening_stock),
    marginSlab: row.margin_slab,
    creditLimitRequested: row.credit_limit_requested === null ? null : Number(row.credit_limit_requested),
    creditCategory: row.credit_category,
    paymentTerms: row.payment_terms,
    targetGoLive: row.target_go_live,
    pushStatus: row.push_status,
    onboardingAppId: row.onboarding_app_id,
    pushedAt: row.pushed_at,
    callAttemptCount: row.call_attempt_count,
    lastCallOutcome: row.last_call_outcome,
    lastCallAt: row.last_call_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerName: row.owner_name,
    ownerRole: row.owner_role,
    duplicateOfLeadId: row.duplicate_of_lead_id,
    duplicateOfFullName: row.duplicate_of_full_name ?? undefined,
    duplicateOfLeadNumber: row.duplicate_of_lead_number ?? undefined,
    inOwnerScope: row.in_owner_scope,
    hasOverdueActivity: row.has_overdue_activity ?? undefined,
    nextActivityDueAt: row.next_activity_due_at ?? null,
    consentPending: row.consent_pending ?? undefined,
  };
}

// Admin-only exception, added deliberately (not the blanket "admin sees
// everything" bypass this file's other comments warn against): an
// unassigned lead (owner_id IS NULL) can never match Rule A/B for anyone,
// by definition, so without this it would be permanently unmanageable by
// anyone at all. Scoped narrowly to that one condition, checked inline via
// the requesting user's real role - no new parameter, so every existing
// caller of these functions picks it up automatically and stays consistent
// (list and detail can never disagree, since both read this same clause).
const UNASSIGNED_ADMIN_CLAUSE = `
  OR (l.owner_id IS NULL AND EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin'))
`;

export async function isLeadVisibleToUser(leadId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM leads l
     WHERE l.id = $2
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
         ${UNASSIGNED_ADMIN_CLAUSE}
         ${TIER_TEAMMATE_CLAUSE}
       )`,
    [userId, leadId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Narrower than isLeadVisibleToUser: true only when the lead's owner is in
// the requesting user's own subtree (Rule A). Deliberately excludes
// lead_shares (Rule B) - a lead shared with someone grants them visibility
// only, not the right to update/delete/share it further. Used by the
// mutating operations below; isLeadVisibleToUser remains the check for
// read-only access (getLeadById, listLeadShares, getLeadConsent).
export async function isLeadInOwnerScope(leadId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM leads l
     WHERE l.id = $2
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         ${UNASSIGNED_ADMIN_CLAUSE}
         ${TIER_TEAMMATE_CLAUSE}
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

// When the creator doesn't explicitly pick an owner, try to auto-assign the
// lead instead of defaulting it to themselves: first by an exact match
// between the lead's territory and a salesperson's own territory (the most
// specific signal, since a territory belongs to exactly one salesperson),
// then by the existing state+category assignment_rules table.
async function resolveAutoAssignee(input: CreateLeadInput, creatorId: string): Promise<string> {
  if (input.territory) {
    const territoryMatch = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE territory = $1 AND is_active = true",
      [input.territory]
    );
    if (territoryMatch.rows.length > 0) {
      return territoryMatch.rows[0].id;
    }
  }

  if (input.stateId) {
    const ruleMatch = await pool.query<{ assigned_user_id: string }>(
      `SELECT assigned_user_id FROM assignment_rules
       WHERE state_id = $1 AND is_active = true AND (category = $2 OR category IS NULL)
       ORDER BY category IS NULL ASC
       LIMIT 1`,
      [input.stateId, input.category ?? null]
    );
    if (ruleMatch.rows.length > 0) {
      return ruleMatch.rows[0].assigned_user_id;
    }
  }

  return creatorId;
}

// The two calling-tier stages a marketing lead walks through before
// reaching the existing Qualified stage, each worked by its own team pool
// (see resolveTierAssignee/getSalesTeamIdByName below). Exported so
// lead-call-center-service.ts's escalation actions and the bulk-import path
// share one real source of truth instead of each hardcoding these strings.
// A third tier (TLC) was removed before any real lead or employee ever
// reached it - SLC is now the last calling tier before Qualified.
export const FLC_STAGE = "FLC";
export const SLC_STAGE = "SLC";

// Lead sharing within a calling tier: any active Call Center employee on the
// SAME sales_team as a lead's current owner can see and work that lead while
// it's still at that owner's own tier stage - not just the one person it
// happens to be assigned to. This is what lets a teammate cover someone
// else's leads on a day they're out, without reassigning ownership (the
// owner stays recorded as whoever it was originally given to; who actually
// worked it shows up correctly in the activity log via created_by/
// assigned_to, which already records the real actor, never the owner).
// Deliberately keyed off l.status being exactly FLC/SLC (not "owner's role is
// call_center") - a Qualified lead still owned by the SLC agent who just
// qualified it (before Send to Field) is NOT covered by this: that handoff
// window is still single-owner by design, same as today.
const TIER_TEAMMATE_CLAUSE = `
  OR (
    l.status IN ('${FLC_STAGE}', '${SLC_STAGE}')
    AND EXISTS (
      SELECT 1 FROM users ru
      JOIN users ou ON ou.id = l.owner_id
      WHERE ru.id = $1 AND ru.role = 'call_center'
        AND ru.sales_team_id IS NOT NULL
        AND ru.sales_team_id = ou.sales_team_id
    )
  )
`;

// Resolves a calling-tier team's id by its exact sales_teams.name (e.g.
// "FLC Team") - sales_teams.name has no unique constraint at the schema
// level, so this takes the first match; the three team rows are seeded
// once in model.ts and never duplicated in practice.
export async function getSalesTeamIdByName(name: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>("SELECT id FROM sales_teams WHERE name = $1 LIMIT 1", [name]);
  return result.rows[0]?.id ?? null;
}

// Least-loaded round robin within one calling-tier team - picks whoever on
// that team currently has the fewest leads still sitting in that tier's own
// stage, so volume self-balances instead of a strict rotation that can't
// tell a fast agent from a slow one apart. Returns null when the team has
// no active member yet - the lead is left unassigned rather than thrown
// away, same as every other "nobody matched" case in this file; it's still
// reachable afterward via the existing admin-sees-unassigned-leads rule.
export async function resolveTierAssignee(teamId: string, stage: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     WHERE u.role = 'call_center' AND u.is_active = true AND u.sales_team_id = $1
     ORDER BY (
       SELECT COUNT(*) FROM leads l WHERE l.owner_id = u.id AND l.status = $2 AND l.is_deleted = false
     ) ASC, random()
     LIMIT 1`,
    [teamId, stage]
  );
  return result.rows[0]?.id ?? null;
}

// Resolves a bulk-import row's free-text "Call Center Executive" column to
// a real account - email first (unique, guaranteed on every user), then
// employee_code (also exists on every user, but nullable/optional) as a
// fallback for sheets that use codes instead of emails. Case-insensitive on
// both, since a spreadsheet's casing is never guaranteed to match what's
// stored. Deliberately does not fall back to a fuzzy name match - a typo'd
// or ambiguous name silently routing a real customer lead to the wrong
// person is a worse outcome than reporting the row as unresolved.
// Maps a sales_teams.name to the stage a lead assigned to that team's
// member should actually land at - e.g. naming an SLC Team person's email
// in the import must land the row at SLC, not FLC, or it would be invisible
// in that person's own queue (scoped by their own team's stage) despite
// genuinely being theirs.
const STAGE_BY_TEAM_NAME: Record<string, string> = {
  "FLC Team": FLC_STAGE,
  "SLC Team": SLC_STAGE,
};

interface CallCenterExecutiveMatch {
  id: string;
  stage: string | null;
}

async function resolveCallCenterExecutiveByIdentifier(identifier: string): Promise<CallCenterExecutiveMatch | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const result = await pool.query<{ id: string; team_name: string | null }>(
    `SELECT u.id, st.name AS team_name
     FROM users u
     LEFT JOIN sales_teams st ON st.id = u.sales_team_id
     WHERE u.role = 'call_center' AND u.is_active = true
       AND (LOWER(u.email) = LOWER($1) OR LOWER(u.employee_code) = LOWER($1))
     LIMIT 1`,
    [trimmed]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, stage: row.team_name ? STAGE_BY_TEAM_NAME[row.team_name] ?? null : null };
}

// Distinct territory values actually in use across leads, for the
// Territory filter dropdown - territory is free text, not a managed list,
// so this is the closest thing to "the territories that exist" today.
export async function listDistinctTerritories(): Promise<string[]> {
  const result = await pool.query<{ territory: string }>(
    "SELECT DISTINCT territory FROM leads WHERE territory IS NOT NULL AND territory <> '' ORDER BY territory ASC"
  );
  return result.rows.map((row) => row.territory);
}

// A lead is still "active" - and blocks a second lead for the same phone
// number - unless it has reached one of the two terminal outcomes. A
// Converted or Closed Lost lead is a finished relationship, so a fresh
// inquiry from the same number later is legitimate, not a duplicate.
const TERMINAL_LEAD_STATUSES = ["Converted", "Closed Lost"];

// Compares only the last 10 digits after stripping everything but digits,
// so "9876543210", "+91 98765 43210" and "091-9876543210" are all
// recognized as the same number even though nothing in this app enforces
// a single phone format at entry time.
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

interface ActiveLeadMatch {
  id: string;
  fullName: string;
  leadNumber: number | null;
  ownerName: string | null;
}

async function findActiveLeadByPhone(phone: string, excludeLeadId?: string): Promise<ActiveLeadMatch | null> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) return null;

  const result = await pool.query<{ id: string; full_name: string; lead_number: number | null; owner_name: string | null }>(
    `SELECT l.id, l.full_name, l.lead_number, u.name AS owner_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.is_deleted = false
       AND l.status NOT IN (${TERMINAL_LEAD_STATUSES.map((_, i) => `$${i + 2}`).join(", ")})
       AND RIGHT(regexp_replace(l.phone, '\\D', '', 'g'), 10) = $1
       AND ($${TERMINAL_LEAD_STATUSES.length + 2}::uuid IS NULL OR l.id <> $${TERMINAL_LEAD_STATUSES.length + 2})
     LIMIT 1`,
    [normalized, ...TERMINAL_LEAD_STATUSES, excludeLeadId ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, fullName: row.full_name, leadNumber: row.lead_number, ownerName: row.owner_name };
}

// What a new/edited lead's own duplicate_of_lead_id should be set to, given
// it now shares a phone number with an existing active lead - created and
// flagged, not rejected, per the client's own requirement to track and
// surface duplicates rather than block them (createLead/updateLead both use
// this). Always collapses to that lead's own original if it's itself
// already flagged, so a duplicate is never more than one hop from the true
// first lead with that number, no matter how many times it's resurfaced.
async function resolveDuplicateOfLeadId(phone: string, excludeLeadId?: string): Promise<string | null> {
  const existing = await findActiveLeadByPhone(phone, excludeLeadId);
  if (!existing) return null;
  const existingRow = await pool.query<{ duplicate_of_lead_id: string | null }>(
    "SELECT duplicate_of_lead_id FROM leads WHERE id = $1",
    [existing.id]
  );
  return existingRow.rows[0]?.duplicate_of_lead_id ?? existing.id;
}

// Used to route an inbound WhatsApp reply to the right lead. Unlike
// findActiveLeadByPhone above, this matches a lead regardless of status - a
// Converted or Closed Lost lead's contact can still text back, and it
// should still land somewhere. When more than one lead shares the number
// (duplicate_of_lead_id is only ever set going forward on new/edited leads,
// not backfilled onto old terminal ones), the most recently updated one wins.
export async function findLeadIdByPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) return null;

  const result = await pool.query<{ id: string }>(
    `SELECT id FROM leads
     WHERE is_deleted = false
       AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalized]
  );
  return result.rows[0]?.id ?? null;
}

export interface CreateLeadOptions {
  // Set only by the marketing-sourced entry points (bulk import, public
  // website form, QR campaign) - never by the manual "Create Lead" form a
  // field rep fills in themselves, which keeps today's instant-assign
  // behavior unchanged. A caller-supplied ownerId (e.g. a website source's
  // configured default owner) still wins over this, same as it already
  // bypasses resolveAutoAssignee below - an admin wiring a specific owner
  // into a campaign is a deliberate fast lane, not something this should
  // override.
  requiresQualification?: boolean;
  // Only meaningful alongside requiresQualification - used by the Call
  // Center workspace's own "Add lead" action (lead-call-center-service.ts's
  // createOwnQueueLead), where the agent logging this contact mid-call is
  // who should work it next, not whoever round-robin would hand it to.
  // Every other requiresQualification caller (bulk import, website form, QR
  // campaign) leaves this unset and keeps the round-robin behavior.
  assignToCreator?: boolean;
}

export async function createLead(
  input: CreateLeadInput,
  creatorId: string,
  ipAddress?: string | null,
  options?: CreateLeadOptions
) {
  const duplicateOfLeadId = input.phone ? await resolveDuplicateOfLeadId(input.phone) : null;

  let ownerId: string | null;
  let status = input.status;
  if (options?.requiresQualification && input.ownerId === undefined) {
    const flcTeamId = await getSalesTeamIdByName("FLC Team");
    ownerId = options.assignToCreator ? creatorId : flcTeamId ? await resolveTierAssignee(flcTeamId, FLC_STAGE) : null;
    status = status ?? FLC_STAGE;
  } else {
    ownerId = input.ownerId ?? (await resolveAutoAssignee(input, creatorId));
  }

  const { columns, placeholders, values } = buildInsert({
    full_name: input.fullName,
    contact_name: input.contactName,
    profession: input.profession,
    start_date: input.startDate,
    qualified_person: input.qualifiedPerson,
    financial_status: input.financialStatus,
    welcome_message_sent: input.welcomeMessageSent,
    // 'New' (capital N) matches pipeline_stages' real key for this stage -
    // same reasoning as 'Converted' on the createCustomerFromLead path
    // below. Used to default to lowercase 'new' here, silently diverging
    // from the Title-Case value the Leads list's own Stage filter and the
    // Dashboard's status breakdown actually group/filter by. A marketing lead
    // defaults to the FLC stage instead (set above), not 'New'.
    status: status ?? "New",
    prospect_status: input.prospectStatus,
    category: input.category,
    owner_id: ownerId,
    duplicate_of_lead_id: duplicateOfLeadId,
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
    entity_type: input.entityType,
    aadhaar_number: input.aadhaarNumber,
    nearest_coco_store: input.nearestCocoStore,
    signage_status: input.signageStatus,
    security_deposit: input.securityDeposit,
    opening_stock: input.openingStock,
    margin_slab: input.marginSlab,
    credit_limit_requested: input.creditLimitRequested,
    credit_category: input.creditCategory,
    payment_terms: input.paymentTerms,
    target_go_live: input.targetGoLive,
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

    if (captured) {
      const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [creatorId]);
      await recordAuditEvent({
        entityType: "consent",
        entityId: lead.id,
        entityLabel: lead.full_name,
        action: "consent_granted",
        summary: `Consent granted - ${lead.full_name}`,
        oldValue: null,
        newValue: input.consent.purposes ?? "Unspecified purpose",
        actorId: creatorId,
        actorName: actorResult.rows[0]?.name ?? null,
        ipAddress,
      });
    }
  }

  return toPublicLead(lead);
}

export interface BulkImportResult {
  created: number;
  skipped: { row: number; reason: string }[];
  errors: { row: number; message: string }[];
  // Rows that WERE created (count toward `created`, same as any other
  // successful row) but not with the executive the sheet named - see the
  // FLC-only check below. Kept separate from `skipped` on purpose: a
  // skipped row needs someone to go fix it and re-import, a redirected row
  // needs nothing further, it's just worth knowing it didn't land with the
  // specific person the sheet said.
  redirected: { row: number; reason: string }[];
}

const MAX_BULK_IMPORT_ROWS = 5000;

// Reuses createLead for every row rather than re-implementing
// auto-assignment, the insert, or the duplicate-phone check - one call per
// row keeps each row's own write atomic (createLead's single INSERT) while
// letting one bad row get reported and skipped without aborting the rest
// of the batch. The only addition here is a within-this-file duplicate
// guard (same normalizePhone used everywhere else), since two rows in the
// same spreadsheet can share a phone number in a way createLead's
// one-row-at-a-time duplicate check can't see on its own.
export async function bulkImportLeads(rows: Record<string, unknown>[], creatorId: string): Promise<BulkImportResult> {
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    throw new ApiError(422, `This file has ${rows.length} rows - the max is ${MAX_BULK_IMPORT_ROWS} per import`);
  }

  const result: BulkImportResult = { created: 0, skipped: [], errors: [], redirected: [] };
  const seenPhones = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for 1-indexing, +1 for the header row the frontend stripped off

    // Checked separately, ahead of the schema - a missing fullName is by
    // far the most common bad row (an empty cell under the mapped column),
    // and zod's default "expected string, received undefined" for a wholly
    // absent key reads like an internal error, not an actionable message.
    const fullName = rows[i].fullName;
    if (typeof fullName !== "string" || !fullName.trim()) {
      result.errors.push({ row: rowNumber, message: "Full name is required" });
      continue;
    }

    const parsed = bulkImportRowSchema.safeParse(rows[i]);
    if (!parsed.success) {
      result.errors.push({ row: rowNumber, message: parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    const row = parsed.data;

    try {
      if (row.phone) {
        const normalized = normalizePhone(row.phone);
        if (normalized.length === 10 && seenPhones.has(normalized)) {
          result.skipped.push({ row: rowNumber, reason: "Duplicate phone number within this file" });
          continue;
        }
        if (normalized.length === 10) seenPhones.add(normalized);
      }

      // An explicit executive identifier bypasses round-robin entirely - the
      // row lands directly in that person's own queue. Deliberately FLC-only
      // (not "whichever tier their team actually is") - every row here is a
      // brand-new, never-called customer, so landing one directly at SLC
      // would let it skip real calling at the earlier tier with nothing to
      // show it happened, just because a sheet named the wrong person (a
      // genuinely easy mistake: a data-entry sheet mixing FLC/SLC staff in
      // one column has no visual difference between them).
      //
      // Naming an SLC person (or an identifier that doesn't resolve at all)
      // falls back to the same FLC round-robin a blank column gets,
      // rather than being skipped outright - confirmed as the wanted
      // behavior over leaving the row out of the import entirely, which
      // risks a real customer never making it into the CRM at all if the
      // skip list goes unnoticed in a large file. ownerId/status are simply
      // left unset below, which is exactly what a row with no
      // assigneeIdentifier gets too - createLead's own FLC-entry branch
      // handles the round-robin assignment either way. Recorded in
      // `redirected`, not `skipped`, since the row DID get created - there's
      // nothing to go fix, just something worth knowing about.
      let ownerId: string | undefined;
      let status: string | undefined;
      if (row.assigneeIdentifier) {
        const assignee = await resolveCallCenterExecutiveByIdentifier(row.assigneeIdentifier);
        if (!assignee) {
          result.redirected.push({
            row: rowNumber,
            reason: `Executive "${row.assigneeIdentifier}" not found or not an active Call Center employee - assigned to FLC round-robin instead`,
          });
        } else if (!assignee.stage) {
          result.redirected.push({
            row: rowNumber,
            reason: `Executive "${row.assigneeIdentifier}" is not assigned to a calling tier yet - assigned to FLC round-robin instead`,
          });
        } else if (assignee.stage !== FLC_STAGE) {
          result.redirected.push({
            row: rowNumber,
            reason: `Executive "${row.assigneeIdentifier}" is on the ${assignee.stage} team, not FLC - assigned to FLC round-robin instead, so every lead still goes through calling in order`,
          });
        } else {
          ownerId = assignee.id;
          status = assignee.stage;
        }
      }

      await createLead({ ...row, ownerId, status }, creatorId, undefined, { requiresQualification: true });
      result.created++;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        result.skipped.push({ row: rowNumber, reason: err.message });
      } else {
        result.errors.push({ row: rowNumber, message: err instanceof ApiError ? err.message : "Failed to import this row" });
      }
    }
  }

  return result;
}

// Backs the Source filter dropdown - real distinct values actually sitting
// on leads today, not a hardcoded guess list that'd drift from whatever's
// really been imported/typed. Unions two separate columns on purpose: a
// lead's source lives in `source` if it came through bulk import, or in
// `inquiry_source` if it came from the manual New Lead form / website / QR
// (see the matching comment on the filter condition above and
// getLeadSourceROI's own note on this same split) - so every real value,
// whichever column it landed in, shows up as one option here. Alphabetical,
// not by frequency - a filter list should be easy to scan, not reordering
// itself as counts change.
export async function getDistinctLeadSources(): Promise<string[]> {
  const result = await pool.query<{ value: string }>(
    `SELECT DISTINCT value FROM (
       SELECT source AS value FROM leads WHERE source IS NOT NULL AND source <> '' AND is_deleted = false
       UNION
       SELECT inquiry_source AS value FROM leads WHERE inquiry_source IS NOT NULL AND inquiry_source <> '' AND is_deleted = false
     ) t ORDER BY value ASC`
  );
  return result.rows.map((r) => r.value);
}

// Backs "My queue"'s own second section in CallCenterPage.tsx - without
// this, the moment a Call Center rep sends their last lead to Field Sales,
// their queue goes completely blank with no trace of what they'd actually
// handled, which read as the work having vanished rather than finished.
// lead_shares rows created by shareLeadBackToSender (lead-call-center-
// service.ts) are exactly "leads this person used to own and has since
// handed off" - nothing else writes that table for that reason today, so
// querying it directly needs no new column or flag. Each row still comes
// back with in_owner_scope: false (real, not assumed - computed the same
// way getLeadById does), since a rep can revisit these but never act on
// them again.
export async function listLeadsHandedOffByUser(requestingUserId: string) {
  const result = await pool.query<LeadRow>(
    `${SUBTREE_CTE}
     SELECT l.*, u.name AS owner_name, u.role AS owner_role,
       dl.full_name AS duplicate_of_full_name, dl.lead_number AS duplicate_of_lead_number,
       (COALESCE(l.owner_id IN (SELECT id FROM subtree), false) ${UNASSIGNED_ADMIN_CLAUSE}) AS in_owner_scope
     FROM leads l
     JOIN lead_shares ls ON ls.lead_id = l.id AND ls.shared_with_user_id = $1
     LEFT JOIN users u ON u.id = l.owner_id
     LEFT JOIN leads dl ON dl.id = l.duplicate_of_lead_id
     WHERE l.is_deleted = false
     ORDER BY ls.created_at DESC`,
    [requestingUserId]
  );
  return result.rows.map(toPublicLead);
}

// skipVisibilityCheck is a narrow, opt-in escape hatch for callers that have
// already made their own admin-trusts-admin decision (see
// fofo-onboarding-service.ts's getHandoff) - a FOFO approval step's
// approver_user_id is frozen at the lead's manager chain when the chain was
// first derived, so a later manager reassignment can leave a step correctly
// decidable by any admin (decideStep already allows this) but blocked from
// even loading, since this lead no longer falls in that admin's subtree.
// Every other caller is unaffected - the option defaults to off.
export async function getLeadById(
  leadId: string,
  requestingUserId: string,
  options?: { skipVisibilityCheck?: boolean }
) {
  if (!options?.skipVisibilityCheck) {
    const visible = await isLeadVisibleToUser(leadId, requestingUserId);
    if (!visible) {
      throw new ApiError(403, "You do not have access to this lead");
    }
  }

  const result = await pool.query<LeadRow>(
    `${SUBTREE_CTE}
     SELECT l.*, u.name AS owner_name, u.role AS owner_role,
       dl.full_name AS duplicate_of_full_name, dl.lead_number AS duplicate_of_lead_number,
       -- Mirrors isLeadInOwnerScope exactly (same subtree membership +
       -- unassigned-admin clause) - the frontend's signal for "can I
       -- actually act on this lead" (Call/Email/Teams/WhatsApp/Edit), as
       -- opposed to merely being able to see it via a lead_shares grant.
       -- See smartflo-service.ts's initiateCallForLead for why that
       -- distinction exists at all.
       (COALESCE(l.owner_id IN (SELECT id FROM subtree), false) ${UNASSIGNED_ADMIN_CLAUSE} ${TIER_TEAMMATE_CLAUSE}) AS in_owner_scope
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
     LEFT JOIN leads dl ON dl.id = l.duplicate_of_lead_id
     WHERE l.id = $2 AND l.is_deleted = false`,
    [requestingUserId, leadId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Lead not found");
  }

  return toPublicLead(result.rows[0]);
}

// Shared by listLeadsForUser (paginated, for the Leads page) and
// listLeadsForExport (unpaginated, for the Export button) - one place that
// decides what a filter means, so "Export" always matches exactly whatever
// the admin currently has filtered on screen instead of a second, drifting
// implementation of the same rules.
export function buildLeadFilterConditions(
  requestingUserId: string,
  filters: Omit<ListLeadsFilters, "page" | "limit">
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = ["l.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(`(
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
    ${UNASSIGNED_ADMIN_CLAUSE}
    ${TIER_TEAMMATE_CLAUSE}
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
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`l.category = $${params.length}`);
  }
  if (filters.source) {
    // Two separate columns hold "where did this lead come from" depending
    // on how it was created - `source` (bulk import only) and
    // `inquiry_source` (the manual New Lead form, website, QR - see
    // getLeadSourceROI's own comment on this same split). A value picked
    // from the filter dropdown can legitimately live in either one
    // depending on the lead, so both are checked rather than just one.
    params.push(filters.source);
    conditions.push(`(l.source = $${params.length} OR l.inquiry_source = $${params.length})`);
  }
  if (filters.overdueOnly) {
    conditions.push(
      `EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.due_date < now() AND a.status <> 'completed')`
    );
  }
  if (filters.highScoreOnly) {
    params.push(HIGH_SCORE_THRESHOLD);
    conditions.push(`l.lead_score >= $${params.length}`);
  }
  if (filters.consentPending) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM consents c WHERE c.lead_id = l.id AND c.captured = true)`);
  }
  if (filters.unassignedOnly) {
    conditions.push(`l.owner_id IS NULL`);
  }

  return { conditions, params };
}

export async function listLeadsForUser(requestingUserId: string, filters: ListLeadsFilters) {
  const { conditions, params } = buildLeadFilterConditions(requestingUserId, filters);
  const whereClause = conditions.join(" AND ");

  // A lightweight companion COUNT using the exact same WHERE/params (minus
  // limit/offset) - needed for a real "X of Y leads" and to know whether
  // more pages exist, now that the frontend no longer loads everything at
  // once.
  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE} SELECT COUNT(*) FROM leads l WHERE ${whereClause}`,
    params
  );

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;
  const listParams = [...params, limit, offset];

  const result = await pool.query<LeadRow>(
    `${SUBTREE_CTE}
     SELECT l.*, u.name AS owner_name, u.role AS owner_role,
       dl.full_name AS duplicate_of_full_name, dl.lead_number AS duplicate_of_lead_number,
       EXISTS (
         SELECT 1 FROM activities a
         WHERE a.lead_id = l.id AND a.due_date < now() AND a.status <> 'completed'
       ) AS has_overdue_activity,
       (
         SELECT MIN(a.due_date) FROM activities a
         WHERE a.lead_id = l.id AND a.due_date IS NOT NULL AND a.status <> 'completed'
       ) AS next_activity_due_at,
       NOT EXISTS (
         SELECT 1 FROM consents c WHERE c.lead_id = l.id AND c.captured = true
       ) AS consent_pending,
       (COALESCE(l.owner_id IN (SELECT id FROM subtree), false) ${UNASSIGNED_ADMIN_CLAUSE} ${TIER_TEAMMATE_CLAUSE}) AS in_owner_scope
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
     LEFT JOIN leads dl ON dl.id = l.duplicate_of_lead_id
     WHERE ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { leads: result.rows.map(toPublicLead), total: Number(countResult.rows[0].count) };
}

export interface ExportLeadRow {
  id: string;
  leadNumber: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  category: string | null;
  status: string;
  source: string | null;
  territory: string | null;
  expectedValue: number | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  ownerTeamName: string | null;
  createdAt: string;
  updatedAt: string;
  internalNotes: string | null;
  rmRemark: string | null;
  lgRemark: string | null;
}

interface ExportLeadQueryRow {
  id: string;
  lead_number: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  category: string | null;
  status: string;
  source: string | null;
  inquiry_source: string | null;
  territory: string | null;
  expected_value: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  owner_team_name: string | null;
  created_at: string;
  updated_at: string;
  internal_notes: string | null;
  rm_remark: string | null;
  lg_remark: string | null;
}

// Mirrors bulkImportLeads' own MAX_BULK_IMPORT_ROWS precedent (5000) - a
// clear 422 asking the admin to narrow their filters, rather than silently
// truncating the file or hanging on an unbounded query/export.
const MAX_EXPORT_ROWS = 20000;

// Same filter rules as listLeadsForUser (via the shared
// buildLeadFilterConditions above), but every matching row at once, no
// pagination - "Export" always matches exactly what's currently filtered on
// the Leads page. owner_team_name (not selected by the paginated list) is
// what lets the export's own owner-trail reconstruction (lead-export-service.ts)
// tell "owner is call_center on FLC Team" apart from "...on SLC Team".
export async function listLeadsForExport(
  requestingUserId: string,
  filters: Omit<ListLeadsFilters, "page" | "limit">
): Promise<ExportLeadRow[]> {
  const { conditions, params } = buildLeadFilterConditions(requestingUserId, filters);
  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query<{ count: string }>(`${SUBTREE_CTE} SELECT COUNT(*) FROM leads l WHERE ${whereClause}`, params);
  const total = Number(countResult.rows[0].count);
  if (total > MAX_EXPORT_ROWS) {
    throw new ApiError(422, `This export would include ${total} leads - narrow your filters to ${MAX_EXPORT_ROWS} or fewer and try again`);
  }

  const result = await pool.query<ExportLeadQueryRow>(
    `${SUBTREE_CTE}
     SELECT l.id, l.lead_number, l.full_name, l.phone, l.email, l.company_name, l.category, l.status,
       COALESCE(l.source, l.inquiry_source) AS source, l.inquiry_source, l.territory, l.expected_value,
       l.owner_id, u.name AS owner_name, u.role AS owner_role, st.name AS owner_team_name,
       l.created_at, l.updated_at, l.internal_notes, l.rm_remark, l.lg_remark
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
     LEFT JOIN sales_teams st ON st.id = u.sales_team_id
     WHERE ${whereClause}
     ORDER BY l.lead_number ASC`,
    params
  );

  return result.rows.map((row) => ({
    id: row.id,
    leadNumber: row.lead_number,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    companyName: row.company_name,
    category: row.category,
    status: row.status,
    source: row.source,
    territory: row.territory,
    expectedValue: row.expected_value === null ? null : Number(row.expected_value),
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerRole: row.owner_role,
    ownerTeamName: row.owner_team_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    internalNotes: row.internal_notes,
    rmRemark: row.rm_remark,
    lgRemark: row.lg_remark,
  }));
}

// Real per-bucket counts for the Leads quick-filter chips (My leads /
// Unassigned / Overdue / FOFO / High score), computed in one query via
// conditional aggregation over the exact same authorization scope
// listLeadsForUser uses - not six separate round trips, and never a second,
// looser visibility rule. "Unassigned" (owner_id IS NULL) reads 0 for
// everyone except admin: for anyone else the subtree/shared condition can
// never match a NULL owner_id, by definition - admin is the one deliberate,
// narrow exception (UNASSIGNED_ADMIN_CLAUSE above), so unassigned leads are
// still manageable by someone instead of permanently invisible to all.
export async function getQuickFilterCounts(requestingUserId: string) {
  const result = await pool.query<{
    all: string;
    my_leads: string;
    unassigned: string;
    overdue: string;
    fofo: string;
    high_score: string;
  }>(
    `${SUBTREE_CTE}
     SELECT
       COUNT(*) AS all,
       COUNT(*) FILTER (WHERE l.owner_id = $1) AS my_leads,
       COUNT(*) FILTER (WHERE l.owner_id IS NULL) AS unassigned,
       COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.due_date < now() AND a.status <> 'completed')
       ) AS overdue,
       COUNT(*) FILTER (WHERE l.category = 'FOFO') AS fofo,
       COUNT(*) FILTER (WHERE l.lead_score >= $2) AS high_score
     FROM leads l
     WHERE l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
         ${UNASSIGNED_ADMIN_CLAUSE}
         ${TIER_TEAMMATE_CLAUSE}
       )`,
    [requestingUserId, HIGH_SCORE_THRESHOLD]
  );

  const row = result.rows[0];
  return {
    all: Number(row.all),
    myLeads: Number(row.my_leads),
    unassigned: Number(row.unassigned),
    overdue: Number(row.overdue),
    fofo: Number(row.fofo),
    highScore: Number(row.high_score),
  };
}

export async function updateLead(
  leadId: string,
  updates: Partial<CreateLeadInput>,
  requestingUserId: string,
  ipAddress?: string | null
) {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  // Tracked separately from the generic fieldMap below since these three are
  // the ones the real Audit trail cares about - captured before the UPDATE
  // runs because the generic dynamic-SET approach here never reads the old
  // row otherwise (unlike updateUser's manager_id change, which already does
  // this same before/after read for manager_change_log).
  const tracksChange =
    updates.category !== undefined ||
    updates.ownerId !== undefined ||
    updates.status !== undefined ||
    updates.internalNotes !== undefined ||
    updates.rmRemark !== undefined ||
    updates.lgRemark !== undefined;
  let before: {
    category: string | null;
    status: string;
    owner_id: string | null;
    full_name: string;
    internal_notes: string | null;
    rm_remark: string | null;
    lg_remark: string | null;
  } | null = null;
  if (tracksChange) {
    const beforeResult = await pool.query<{
      category: string | null;
      status: string;
      owner_id: string | null;
      full_name: string;
      internal_notes: string | null;
      rm_remark: string | null;
      lg_remark: string | null;
    }>("SELECT category, status, owner_id, full_name, internal_notes, rm_remark, lg_remark FROM leads WHERE id = $1", [leadId]);
    before = beforeResult.rows[0] ?? null;
  }

  // Only re-checked when the phone number is actually being changed - same
  // flag-not-block behavior as createLead above, so editing a lead's number
  // to match another active one re-links it instead of silently staying
  // unflagged.
  const duplicateOfLeadId = updates.phone ? await resolveDuplicateOfLeadId(updates.phone, leadId) : undefined;

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
    duplicate_of_lead_id: duplicateOfLeadId,
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
    entity_type: updates.entityType,
    aadhaar_number: updates.aadhaarNumber,
    nearest_coco_store: updates.nearestCocoStore,
    signage_status: updates.signageStatus,
    security_deposit: updates.securityDeposit,
    opening_stock: updates.openingStock,
    margin_slab: updates.marginSlab,
    credit_limit_requested: updates.creditLimitRequested,
    credit_category: updates.creditCategory,
    payment_terms: updates.paymentTerms,
    target_go_live: updates.targetGoLive,
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

  // Own placeholder (not reusing updated_by's) purely for readability - this
  // one feeds the in_owner_scope computation below, a different purpose
  // than attributing the edit.
  params.push(requestingUserId);
  const scopeUserIdx = params.length;

  params.push(leadId);
  const leadIdIdx = params.length;

  // Computing in_owner_scope here (not just leaving it to the next
  // getLeadById/listLeadsForUser read) matters specifically for sendToField/
  // reassignLead - both return this exact object straight to the frontend,
  // and an ownership-changing update is exactly the moment the caller's own
  // in_owner_scope can flip from true to false (e.g. a Call Center rep
  // handing a lead to Field Sales loses owner-scope on their own very next
  // action). Same mirror of isLeadInOwnerScope as getLeadById/
  // listLeadsForUser use.
  const result = await pool.query<LeadRow>(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM users WHERE id = $${scopeUserIdx}
       UNION ALL
       SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
     )
     UPDATE leads SET ${setClauses.join(", ")} WHERE id = $${leadIdIdx}
     RETURNING *, (
       COALESCE(owner_id IN (SELECT id FROM subtree), false)
       OR (owner_id IS NULL AND EXISTS (SELECT 1 FROM users ru WHERE ru.id = $${scopeUserIdx} AND ru.role = 'admin'))
     ) AS in_owner_scope`,
    params
  );
  const after = result.rows[0];

  if (before) {
    const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);
    const actorName = actorResult.rows[0]?.name ?? null;

    if (updates.category !== undefined && updates.category !== before.category) {
      await recordAuditEvent({
        entityType: "lead",
        entityId: leadId,
        entityLabel: after.full_name,
        action: "category_changed",
        summary: `Category changed - ${after.full_name}`,
        oldValue: before.category,
        newValue: after.category,
        actorId: requestingUserId,
        actorName,
        ipAddress,
      });
    }

    // Internal Notes/RM Remark/LG Remark (LeadFormDrawer's "Visible only to
    // your team" section) are plain mutable text with no change-log of their
    // own, unlike everything else in the lead's History - this is what gives
    // them one going forward, each field its own event so the History tab
    // can show exactly which note changed, by whom, and when.
    const noteFields: { key: "internalNotes" | "rmRemark" | "lgRemark"; column: "internal_notes" | "rm_remark" | "lg_remark"; action: string; label: string }[] = [
      { key: "internalNotes", column: "internal_notes", action: "internal_notes_updated", label: "Internal notes" },
      { key: "rmRemark", column: "rm_remark", action: "rm_remark_updated", label: "RM remark" },
      { key: "lgRemark", column: "lg_remark", action: "lg_remark_updated", label: "LG remark" },
    ];
    for (const field of noteFields) {
      if (updates[field.key] !== undefined && updates[field.key] !== before[field.column]) {
        await recordAuditEvent({
          entityType: "lead",
          entityId: leadId,
          entityLabel: after.full_name,
          action: field.action,
          summary: `${field.label} updated - ${after.full_name}`,
          oldValue: before[field.column],
          newValue: after[field.column],
          actorId: requestingUserId,
          actorName,
          ipAddress,
        });
      }
    }

    const statusChanged = updates.status !== undefined && updates.status !== before.status;
    const ownerChanged = updates.ownerId !== undefined && updates.ownerId !== before.owner_id;

    // Owner names resolved once, up front, since both the combined entry
    // below and the owner-only entry further down need them - was
    // previously only looked up inside the owner block, duplicating this
    // query if a combined entry needed it too.
    let oldOwnerName = "Unassigned";
    let newOwnerName = "Unassigned";
    if (ownerChanged) {
      const ownerIds = [before.owner_id, updates.ownerId].filter((id): id is string => id !== null);
      const namesResult = ownerIds.length
        ? await pool.query<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ANY($1)", [ownerIds])
        : { rows: [] as { id: string; name: string }[] };
      const nameById = new Map(namesResult.rows.map((r) => [r.id, r.name]));
      oldOwnerName = before.owner_id ? nameById.get(before.owner_id) ?? "Unassigned" : "Unassigned";
      newOwnerName = updates.ownerId ? nameById.get(updates.ownerId) ?? "Unassigned" : "Unassigned";
    }

    // A single action (today, only escalateTier - FLC->SLC) that changes
    // both stage and owner together gets one combined history
    // entry instead of two separate ones that happened to fire at the same
    // moment - "Lead stage changed" immediately followed by "Salesperson
    // reassigned" read like two unrelated events when they were actually
    // one. Anything that changes only one of the two (a plain status edit,
    // Send to Field Sales, Reassign) keeps its own existing single entry
    // below, unaffected.
    if (statusChanged && ownerChanged) {
      await recordAuditEvent({
        entityType: "lead",
        entityId: leadId,
        entityLabel: after.full_name,
        action: "escalated",
        summary: `Escalated - ${after.full_name}`,
        oldValue: `${before.status} · ${oldOwnerName}`,
        newValue: `${after.status} · ${newOwnerName}`,
        actorId: requestingUserId,
        actorName,
        ipAddress,
      });
    } else if (statusChanged) {
      await recordAuditEvent({
        entityType: "lead",
        entityId: leadId,
        entityLabel: after.full_name,
        action: "status_changed",
        summary: `Lead stage changed - ${after.full_name}`,
        oldValue: before.status,
        newValue: after.status,
        actorId: requestingUserId,
        actorName,
        ipAddress,
      });
    }

    if (statusChanged) {
      // A customer is never created directly - it's auto-created the moment
      // a lead reaches 'Converted', whether that happens here (a direct
      // status edit) or via opportunity-service.ts's convertLeadToOpportunity
      // (which calls createCustomerFromLead itself, since its own status
      // UPDATE is a separate raw-SQL write that never reaches this
      // function). 'Converted' - capital C - matches pipeline_stages' real
      // key for this stage, the same value the generic status dropdown
      // writes. Idempotent (ON CONFLICT (lead_id) DO NOTHING inside
      // createCustomerFromLead), so re-saving an already-converted lead is
      // a no-op, not a duplicate. Caught, not rethrown: the lead's own
      // status UPDATE above already committed by this point, so a failure
      // here must not turn into a 500 that tells the caller the conversion
      // failed when it actually succeeded - it would just mean the
      // customer row needs a retry.
      if (after.status === "Converted") {
        try {
          await createCustomerFromLead(after);
        } catch (err) {
          console.error(`Failed to auto-create customer for converted lead ${leadId}:`, err);
        }
      }
    }
    if (ownerChanged && updates.ownerId !== undefined) {
      if (!statusChanged) {
        await recordAuditEvent({
          entityType: "lead",
          entityId: leadId,
          entityLabel: after.full_name,
          action: "owner_reassigned",
          summary: `Salesperson reassigned - ${after.full_name}`,
          oldValue: oldOwnerName,
          newValue: newOwnerName,
          actorId: requestingUserId,
          actorName,
          ipAddress,
        });
      }

      // Keeps an already-converted customer's ownership in step with its
      // lead - see syncCustomerOwnerFromLead's own comment for why this
      // matters (a no-op when this lead never converted). Runs regardless
      // of whether statusChanged too - ownership syncing isn't tied to the
      // audit-entry combining above.
      await syncCustomerOwnerFromLead(leadId, updates.ownerId);
    }
  }

  return toPublicLead(after);
}

export async function deleteLead(leadId: string, requestingUserId: string, ipAddress?: string | null): Promise<void> {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const leadResult = await pool.query<{ full_name: string }>("SELECT full_name FROM leads WHERE id = $1", [leadId]);
  const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);

  await pool.query(
    "UPDATE leads SET is_deleted = true, updated_by = $1, updated_at = now() WHERE id = $2",
    [requestingUserId, leadId]
  );

  if (leadResult.rows[0]) {
    await recordAuditEvent({
      entityType: "lead",
      entityId: leadId,
      entityLabel: leadResult.rows[0].full_name,
      action: "deleted",
      summary: `Lead deleted - ${leadResult.rows[0].full_name}`,
      oldValue: "Active",
      newValue: "Deleted",
      actorId: requestingUserId,
      actorName: actorResult.rows[0]?.name ?? null,
      ipAddress,
    });
  }
}

export async function shareLead(leadId: string, targetUserId: string, sharedByUserId: string): Promise<void> {
  const inScope = await isLeadInOwnerScope(leadId, sharedByUserId);
  if (!inScope) {
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
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
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

export interface LeadTimelineEntry {
  kind: "activity" | "comment" | "audit";
  id: string;
  date: string;
  activity: Awaited<ReturnType<typeof listActivitiesForLead>>[number] | null;
  comment:
    | (Awaited<ReturnType<typeof listCommentsForActivities>>[number] & {
        activityType: string;
        activitySubject: string | null;
      })
    | null;
  event: Awaited<ReturnType<typeof listAuditLogForEntity>>[number] | null;
}

// Powers the lead detail page's single "History" tab - every real
// communication (calls/emails/meetings/site visits/WhatsApp/internal,
// scheduled or completed), every remark anyone left on one, and every real
// owner/status/category change, merged into one chronological feed. Read-only,
// same visibility rule as viewing the lead itself (not owner-scope - anyone
// who can see this lead can see its full history), matching
// listOpportunityHistory's/getCustomerTimeline's own reasoning. Replaces the
// old split Logs tab + History drawer, which each showed a different partial
// slice of this same story.
export async function getLeadTimeline(leadId: string, requestingUserId: string): Promise<LeadTimelineEntry[]> {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const [activities, auditEvents] = await Promise.all([
    listActivitiesForLead(leadId, requestingUserId),
    listAuditLogForEntity("lead", leadId),
  ]);
  const comments = await listCommentsForActivities(activities.map((a) => a.id));
  const activityById = new Map(activities.map((a) => [a.id, a]));

  const entries: LeadTimelineEntry[] = [
    ...activities.map((a) => ({
      kind: "activity" as const,
      id: a.id,
      date: a.status === "completed" ? a.updatedAt : a.createdAt,
      activity: a,
      comment: null,
      event: null,
    })),
    ...comments.map((c) => {
      const parent = activityById.get(c.activityId);
      return {
        kind: "comment" as const,
        id: c.id,
        date: c.createdAt,
        activity: null,
        comment: { ...c, activityType: parent?.type ?? "internal", activitySubject: parent?.subject ?? null },
        event: null,
      };
    }),
    ...auditEvents.map((e) => ({
      kind: "audit" as const,
      id: e.id,
      date: e.createdAt,
      activity: null,
      comment: null,
      event: e,
    })),
  ];

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return entries;
}

// skipVisibilityCheck mirrors getLeadById's own escape hatch, for the exact
// same reason (see that function's comment): fofo-onboarding-service.ts's
// getHandoff fetches both the lead and its consent record for an admin
// viewing a FOFO handoff whose owner may have since left that admin's
// subtree. The generic /leads/:id/consent controller never passes this -
// only getHandoff does, so every other caller keeps the normal check.
export async function getLeadConsent(
  leadId: string,
  requestingUserId: string,
  options?: { skipVisibilityCheck?: boolean }
) {
  if (!options?.skipVisibilityCheck) {
    const visible = await isLeadVisibleToUser(leadId, requestingUserId);
    if (!visible) {
      throw new ApiError(403, "You do not have access to this lead");
    }
  }

  const result = await pool.query(
    `SELECT id, captured, method, purposes, evidence_ref AS "evidenceRef", notes, status, captured_at AS "capturedAt"
     FROM consents WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  );

  return result.rows[0] ?? null;
}
