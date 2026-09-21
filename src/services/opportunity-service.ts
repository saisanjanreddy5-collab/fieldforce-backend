import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isLeadInOwnerScope, isLeadVisibleToUser } from "./lead-service";

// Reuses the same "subtree" idea as leads: an opportunity is visible to a
// user exactly when the lead it belongs to is visible to that user (Rule A
// hierarchy chain, or Rule B explicit share on the lead).
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

interface OpportunityRow {
  id: string;
  lead_id: string;
  name: string | null;
  value: string | null;
  stage: string;
  close_date: string | null;
  probability: string | null;
  contact_name: string | null;
  notes: string | null;
  won_at: string | null;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityInput {
  name?: string;
  value?: number;
  stage?: string;
  closeDate?: string;
  probability?: number;
  contactName?: string;
  notes?: string;
}

export interface ListOpportunitiesFilters {
  stage?: string;
  leadId?: string;
  category?: string;
  ownerId?: string;
  zoneId?: string;
  territory?: string;
  salesTeamId?: string;
  search?: string;
  page: number;
  limit: number;
}

interface OpportunityListRow extends OpportunityRow {
  lead_full_name: string;
  lead_category: string | null;
  lead_store_city: string | null;
  lead_store_state: string | null;
  lead_zone_id: string | null;
  lead_territory: string | null;
  lead_sales_team_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

function toPublicOpportunity(row: OpportunityRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    value: row.value === null ? null : Number(row.value),
    stage: row.stage,
    closeDate: row.close_date,
    probability: row.probability === null ? null : Number(row.probability),
    contactName: row.contact_name,
    notes: row.notes,
    wonAt: row.won_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The Kanban board needs to show more than the raw opportunity row (the
// lead's name, category tag, city, and assigned salesperson) - a separate
// mapper rather than bloating every other call site with unused joins.
function toPublicOpportunityListItem(row: OpportunityListRow) {
  return {
    ...toPublicOpportunity(row),
    leadFullName: row.lead_full_name,
    leadCategory: row.lead_category,
    leadStoreCity: row.lead_store_city,
    leadStoreState: row.lead_store_state,
    leadZoneId: row.lead_zone_id,
    leadTerritory: row.lead_territory,
    leadSalesTeamId: row.lead_sales_team_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
  };
}

export async function isOpportunityVisibleToUser(opportunityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.id = $2
       AND o.is_deleted = false
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
       )`,
    [userId, opportunityId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Narrower than isOpportunityVisibleToUser: true only when the underlying
// lead's owner is in the requesting user's subtree. Excludes lead_shares,
// mirroring isLeadInOwnerScope in lead-service.ts - an opportunity visible
// only because its lead was shared grants view access, not update/delete.
export async function isOpportunityInOwnerScope(opportunityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.id = $2
       AND o.is_deleted = false
       AND l.is_deleted = false
       AND l.owner_id IN (SELECT id FROM subtree)`,
    [userId, opportunityId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Conversion mutates the source lead (status -> 'converted', below) as well
// as creating the opportunity, so - like update/delete/share - it requires
// owner scope, not mere shared visibility. A lead shared with someone but
// not owned by them (or a subordinate of theirs) cannot be converted.
export async function convertLeadToOpportunity(leadId: string, input: OpportunityInput, requestingUserId: string) {
  const leadInScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!leadInScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  // A brand-new opportunity can start life already in 'won' (e.g. "+Add"
  // clicked directly in the Won column) - that's a transition into won too,
  // same as an update, so it gets the same won_at stamp.
  const result = await pool.query<OpportunityRow>(
    `INSERT INTO opportunities (lead_id, name, value, stage, close_date, probability, contact_name, notes, created_by, updated_by, won_at)
     VALUES ($1, $2, $3, COALESCE($4, 'new'), $5, $6, $7, $8, $9, $9, CASE WHEN $4 = 'won' THEN now() ELSE NULL END)
     RETURNING *`,
    [
      leadId,
      input.name ?? null,
      input.value ?? null,
      input.stage ?? null,
      input.closeDate ?? null,
      input.probability ?? null,
      input.contactName ?? null,
      input.notes ?? null,
      requestingUserId,
    ]
  );

  await pool.query(
    "UPDATE leads SET status = 'converted', updated_by = $1, updated_at = now() WHERE id = $2",
    [requestingUserId, leadId]
  );

  return toPublicOpportunity(result.rows[0]);
}

export async function listOpportunitiesForLead(leadId: string, requestingUserId: string) {
  const leadVisible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!leadVisible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query<OpportunityRow>(
    "SELECT * FROM opportunities WHERE lead_id = $1 AND is_deleted = false ORDER BY created_at DESC",
    [leadId]
  );

  return result.rows.map(toPublicOpportunity);
}

export async function listOpportunitiesForUser(requestingUserId: string, filters: ListOpportunitiesFilters) {
  const conditions: string[] = ["o.is_deleted = false", "l.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(`(
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
  )`);

  if (filters.stage) {
    params.push(filters.stage);
    conditions.push(`o.stage = $${params.length}`);
  }
  if (filters.leadId) {
    params.push(filters.leadId);
    conditions.push(`o.lead_id = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`l.category = $${params.length}`);
  }
  if (filters.ownerId) {
    params.push(filters.ownerId);
    conditions.push(`l.owner_id = $${params.length}`);
  }
  if (filters.zoneId) {
    params.push(filters.zoneId);
    conditions.push(`l.zone_id = $${params.length}`);
  }
  if (filters.territory) {
    params.push(filters.territory);
    conditions.push(`l.territory = $${params.length}`);
  }
  if (filters.salesTeamId) {
    params.push(filters.salesTeamId);
    conditions.push(`l.sales_team_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(o.name ILIKE $${params.length} OR l.full_name ILIKE $${params.length})`);
  }

  params.push(filters.limit, (filters.page - 1) * filters.limit);

  const result = await pool.query<OpportunityListRow>(
    `${SUBTREE_CTE}
     SELECT o.*, l.full_name AS lead_full_name, l.category AS lead_category,
       l.store_city AS lead_store_city, l.store_state AS lead_store_state,
       l.zone_id AS lead_zone_id, l.territory AS lead_territory, l.sales_team_id AS lead_sales_team_id,
       l.owner_id AS owner_id, u.name AS owner_name
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY o.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows.map(toPublicOpportunityListItem);
}

export async function getOpportunityById(id: string, requestingUserId: string) {
  const visible = await isOpportunityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  const result = await pool.query<OpportunityRow>(
    "SELECT * FROM opportunities WHERE id = $1 AND is_deleted = false",
    [id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Opportunity not found");
  }

  return toPublicOpportunity(result.rows[0]);
}

export async function updateOpportunity(id: string, updates: OpportunityInput, requestingUserId: string) {
  const inScope = await isOpportunityInOwnerScope(id, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    value: updates.value,
    stage: updates.stage,
    close_date: updates.closeDate,
    probability: updates.probability,
    contact_name: updates.contactName,
    notes: updates.notes,
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
    return getOpportunityById(id, requestingUserId);
  }

  // Stamp won_at the moment stage actually transitions into 'won' - not on
  // every edit while it's already won (won_at is left alone), and not
  // touched at all when moving away from won (the historical value is
  // preserved, never cleared).
  if (updates.stage === "won") {
    const current = await pool.query<{ stage: string }>("SELECT stage FROM opportunities WHERE id = $1", [id]);
    if (current.rows[0]?.stage !== "won") {
      setClauses.push("won_at = now()");
    }
  }

  params.push(requestingUserId);
  setClauses.push(`updated_by = $${params.length}`);
  setClauses.push("updated_at = now()");

  params.push(id);

  const result = await pool.query<OpportunityRow>(
    `UPDATE opportunities SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return toPublicOpportunity(result.rows[0]);
}

export async function deleteOpportunity(id: string, requestingUserId: string): Promise<void> {
  const inScope = await isOpportunityInOwnerScope(id, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  await pool.query(
    "UPDATE opportunities SET is_deleted = true, updated_by = $1, updated_at = now() WHERE id = $2",
    [requestingUserId, id]
  );
}
