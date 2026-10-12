import { pool } from "../config/db";

// Same hierarchy-visibility shape as every other module (Leads, Customers,
// Activity Calendar) - walk DOWN from the requesting user to find their
// subtree, a call is visible when whoever placed it (assigned_to, which
// smartflo-service.ts's initiateCallForLead defaults to the caller) is in
// that subtree.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// Same join shape as activity-service.ts's own listActivitiesForUser: a call
// can in principle be tied to an opportunity instead of a lead directly (the
// activities table's CHECK allows either), and either way resolves to a
// lead for the is_deleted check - a soft-deleted lead's calls disappear from
// Call Center exactly like they already disappear from the Activity
// Calendar, instead of lingering with a dead lead's name.
const JOIN_CLAUSE = `
  LEFT JOIN opportunities o ON o.id = a.opportunity_id
  JOIN leads l ON l.id = COALESCE(a.lead_id, o.lead_id)
  LEFT JOIN users u ON u.id = a.assigned_to
`;

interface CallRow {
  id: string;
  lead_id: string | null;
  assigned_to: string | null;
  subject: string | null;
  status: string;
  due_date: string | null;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  lead_full_name: string | null;
  lead_phone: string | null;
  assigned_to_name: string | null;
}

function toPublicCall(row: CallRow) {
  const details = row.details ?? {};
  return {
    id: row.id,
    leadId: row.lead_id,
    leadFullName: row.lead_full_name,
    leadPhone: row.lead_phone,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name,
    subject: row.subject,
    status: row.status,
    dueDate: row.due_date,
    outcome: typeof details.outcome === "string" ? details.outcome : null,
    recordingUrl: typeof details.recordingUrl === "string" ? details.recordingUrl : null,
    durationSeconds: typeof details.durationSeconds === "number" ? details.durationSeconds : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListCallsFilters {
  page: number;
  limit: number;
  assignedTo?: string;
}

// The historical call log - every call Smartflo has actually placed
// (status is always 'completed' the moment initiateCallForLead creates it,
// see smartflo-service.ts). Scheduled-but-not-yet-made calls deliberately
// don't show up here, only in listUpcomingCalls below - same "scheduled vs
// history" split leads/tabs/ActivityTab.tsx and LogsTab.tsx already use.
export async function listCalls(requestingUserId: string, filters: ListCallsFilters) {
  const conditions: string[] = ["a.type = 'call'", "a.status = 'completed'", "l.is_deleted = false", "a.assigned_to IN (SELECT id FROM subtree)"];
  const params: unknown[] = [requestingUserId];

  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`a.assigned_to = $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE} SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE} WHERE ${whereClause}`,
    params
  );

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;
  const listParams = [...params, limit, offset];

  const result = await pool.query<CallRow>(
    `${SUBTREE_CTE}
     SELECT a.*, l.full_name AS lead_full_name, l.phone AS lead_phone, u.name AS assigned_to_name
     FROM activities a
     ${JOIN_CLAUSE}
     WHERE ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { calls: result.rows.map(toPublicCall), total: Number(countResult.rows[0].count) };
}

export interface ListUpcomingCallsFilters {
  limit: number;
}

// The "queue" - calls someone scheduled for later (type='call', not yet
// made) via the existing Activity Calendar "+ Add action" flow. Nothing new
// to build here: this data already exists, it just wasn't surfaced as its
// own view before.
export async function listUpcomingCalls(requestingUserId: string, filters: ListUpcomingCallsFilters) {
  const result = await pool.query<CallRow>(
    `${SUBTREE_CTE}
     SELECT a.*, l.full_name AS lead_full_name, l.phone AS lead_phone, u.name AS assigned_to_name
     FROM activities a
     ${JOIN_CLAUSE}
     WHERE a.type = 'call' AND a.status <> 'completed' AND l.is_deleted = false
       AND a.assigned_to IN (SELECT id FROM subtree)
     ORDER BY a.due_date ASC NULLS LAST
     LIMIT $2`,
    [requestingUserId, filters.limit]
  );

  return result.rows.map(toPublicCall);
}
