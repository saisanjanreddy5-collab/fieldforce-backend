import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isLeadVisibleToUser } from "./lead-service";

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
  search?: string;
  page: number;
  limit: number;
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
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export async function convertLeadToOpportunity(leadId: string, input: OpportunityInput, requestingUserId: string) {
  const leadVisible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!leadVisible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query<OpportunityRow>(
    `INSERT INTO opportunities (lead_id, name, value, stage, close_date, probability, contact_name, notes, created_by, updated_by)
     VALUES ($1, $2, $3, COALESCE($4, 'new'), $5, $6, $7, $8, $9, $9)
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
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`o.name ILIKE $${params.length}`);
  }

  params.push(filters.limit, (filters.page - 1) * filters.limit);

  const result = await pool.query<OpportunityRow>(
    `${SUBTREE_CTE}
     SELECT o.* FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY o.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows.map(toPublicOpportunity);
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
  const visible = await isOpportunityVisibleToUser(id, requestingUserId);
  if (!visible) {
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
  const visible = await isOpportunityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  await pool.query(
    "UPDATE opportunities SET is_deleted = true, updated_by = $1, updated_at = now() WHERE id = $2",
    [requestingUserId, id]
  );
}
