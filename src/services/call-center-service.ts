import { pool } from "../config/db";
import { customerLabel } from "./customer-service";

// Same hierarchy-visibility shape as every other module (Leads, Customers,
// Activity Calendar) - walk DOWN from the requesting user to find their
// subtree.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// A call is visible exactly when its lead is - matches
// activity-service.ts's own listActivitiesForUser/isActivityVisibleToUser
// (the lead's owner, or an explicit lead_shares grant), NOT "whoever placed
// the call" (a.assigned_to). This used to be the lead's owner/subtree
// check but was built against assigned_to instead - a real authorization
// drift, not a stylistic difference: a manager whose subordinate has
// share-only access to someone else's lead could see that call here with
// no access to the lead anywhere else in the app, while a call placed by
// someone outside the manager's team on a lead the manager genuinely owns
// would vanish from this module despite showing in that lead's own
// Activity tab.
const VISIBILITY_CLAUSE = `
  (
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
  )
`;

// Same join shape as activity-service.ts's own listActivitiesForUser: a call
// can in principle be tied to an opportunity instead of a lead directly (the
// activities table's CHECK allows either), and either way resolves to a
// lead for the is_deleted check - a soft-deleted lead's calls disappear from
// Call Center exactly like they already disappear from the Activity
// Calendar, instead of lingering with a dead lead's name. The customers
// LEFT JOIN is for the real reference label below - most leads a rep calls
// haven't converted yet, so this is genuinely optional, not a requirement.
const JOIN_CLAUSE = `
  LEFT JOIN opportunities o ON o.id = a.opportunity_id
  JOIN leads l ON l.id = COALESCE(a.lead_id, o.lead_id)
  LEFT JOIN users u ON u.id = a.assigned_to
  LEFT JOIN customers cust ON cust.lead_id = l.id AND cust.is_deleted = false
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
  lead_number: number | null;
  lead_category: string | null;
  customer_id: string | null;
  customer_number: number | null;
  assigned_to_name: string | null;
}

function toPublicCall(row: CallRow) {
  const details = row.details ?? {};
  // Once a lead converts, the real-world record of it is the Customer, not
  // the Lead anymore - same "Lead L-xxxx" / "Customer C-xxxxx" distinction
  // the rest of this app already draws, not a new convention invented here.
  const referenceLabel =
    row.customer_number !== null
      ? `Customer ${customerLabel(row.customer_number)}`
      : row.lead_number !== null
        ? `Lead L-${row.lead_number}`
        : null;

  return {
    id: row.id,
    leadId: row.lead_id,
    leadFullName: row.lead_full_name,
    leadPhone: row.lead_phone,
    // Lets the Call Center queue offer a per-contact picker when placing a
    // queued call for a lead that's since converted - null pre-conversion,
    // same as referenceLabel's own fallback.
    customerId: row.customer_id,
    referenceLabel,
    category: row.lead_category,
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
  const conditions: string[] = ["a.type = 'call'", "a.status = 'completed'", "l.is_deleted = false", VISIBILITY_CLAUSE];
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
     SELECT a.*, l.full_name AS lead_full_name, l.phone AS lead_phone, l.lead_number, l.category AS lead_category,
       cust.id AS customer_id, cust.customer_number, u.name AS assigned_to_name
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
     SELECT a.*, l.full_name AS lead_full_name, l.phone AS lead_phone, l.lead_number, l.category AS lead_category,
       cust.id AS customer_id, cust.customer_number, u.name AS assigned_to_name
     FROM activities a
     ${JOIN_CLAUSE}
     WHERE a.type = 'call' AND a.status <> 'completed' AND l.is_deleted = false
       AND ${VISIBILITY_CLAUSE}
     ORDER BY a.due_date ASC NULLS LAST
     LIMIT $2`,
    [requestingUserId, filters.limit]
  );

  return result.rows.map(toPublicCall);
}

interface CallCenterStatsRow {
  calls_today: string;
  total_calls: string;
  connected_count: string;
  recorded_count: string;
  avg_handle_seconds: string | null;
  in_queue_count: string;
  overdue_in_queue_count: string;
}

// The stat cards used to be computed client-side over whatever page of
// calls happened to be loaded (capped at 200), so connectedPercent/
// recordedPercent/avgHandleSeconds silently became a skewed sample once an
// org passed 200 historical calls, while still being labeled "of all
// calls". Real aggregates, computed here over every call this user can
// see - not a page of them - so they stay correct regardless of volume.
// "Today" is anchored to Asia/Kolkata, matching activity-service.ts's own
// getCalendarStats, not the viewer's browser clock.
export async function getCallCenterStats(requestingUserId: string) {
  const result = await pool.query<CallCenterStatsRow>(
    `${SUBTREE_CTE},
     bounds AS (
       SELECT
         (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS day_start,
         (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') + interval '1 day' AS day_end
     )
     SELECT
       (SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE}, bounds b
        WHERE a.type = 'call' AND a.status = 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}
          AND a.created_at >= b.day_start AND a.created_at < b.day_end) AS calls_today,
       (SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE}
        WHERE a.type = 'call' AND a.status = 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}) AS total_calls,
       (SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE}
        WHERE a.type = 'call' AND a.status = 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}
          AND a.details->>'outcome' LIKE 'Connected%') AS connected_count,
       (SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE}
        WHERE a.type = 'call' AND a.status = 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}
          AND a.details->>'recordingUrl' IS NOT NULL) AS recorded_count,
       (SELECT AVG((a.details->>'durationSeconds')::numeric) FROM activities a ${JOIN_CLAUSE}
        WHERE a.type = 'call' AND a.status = 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}
          AND a.details->>'durationSeconds' IS NOT NULL) AS avg_handle_seconds,
       (SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE}
        WHERE a.type = 'call' AND a.status <> 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}) AS in_queue_count,
       (SELECT COUNT(*) FROM activities a ${JOIN_CLAUSE}
        WHERE a.type = 'call' AND a.status <> 'completed' AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}
          AND a.due_date IS NOT NULL AND a.due_date < now()) AS overdue_in_queue_count`,
    [requestingUserId]
  );

  const row = result.rows[0];
  const totalCalls = Number(row.total_calls);
  const connectedCount = Number(row.connected_count);
  const recordedCount = Number(row.recorded_count);

  return {
    callsToday: Number(row.calls_today),
    connectedPercent: totalCalls > 0 ? Math.round((connectedCount / totalCalls) * 100) : 0,
    avgHandleSeconds: row.avg_handle_seconds !== null ? Math.round(Number(row.avg_handle_seconds)) : null,
    recordedPercent: totalCalls > 0 ? Math.round((recordedCount / totalCalls) * 100) : 0,
    inQueue: Number(row.in_queue_count),
    overdueInQueue: Number(row.overdue_in_queue_count),
  };
}
