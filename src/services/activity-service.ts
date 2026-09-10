import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isLeadVisibleToUser } from "./lead-service";
import { isOpportunityVisibleToUser } from "./opportunity-service";

// An activity is visible whenever the lead it (directly or, via an
// opportunity, indirectly) belongs to is visible - same Rule A/B as leads.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

interface ActivityRow {
  id: string;
  type: string;
  lead_id: string | null;
  opportunity_id: string | null;
  assigned_to: string | null;
  subject: string | null;
  due_date: string | null;
  status: string;
  details: Record<string, unknown>;
  latitude: string | null;
  longitude: string | null;
  external_ref_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  activity_id: string;
  user_id: string | null;
  comment: string;
  created_at: string;
}

export interface ActivityInput {
  type?: string;
  subject?: string;
  dueDate?: string;
  status?: string;
  assignedTo?: string;
  details?: Record<string, unknown>;
  latitude?: number;
  longitude?: number;
  externalRefId?: string;
}

export interface ListActivitiesFilters {
  type?: string;
  leadId?: string;
  opportunityId?: string;
  status?: string;
  assignedTo?: string;
  page: number;
  limit: number;
}

function toPublicActivity(row: ActivityRow) {
  return {
    id: row.id,
    type: row.type,
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    assignedTo: row.assigned_to,
    subject: row.subject,
    dueDate: row.due_date,
    status: row.status,
    details: row.details,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    externalRefId: row.external_ref_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublicComment(row: CommentRow) {
  return {
    id: row.id,
    activityId: row.activity_id,
    userId: row.user_id,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export async function isActivityVisibleToUser(activityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM activities a
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     JOIN leads l ON l.id = COALESCE(a.lead_id, o.lead_id)
     WHERE a.id = $2
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
       )`,
    [userId, activityId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function insertActivity(
  input: ActivityInput,
  requestingUserId: string,
  leadId: string | null,
  opportunityId: string | null
) {
  if (!input.type) {
    throw new ApiError(422, "Activity type is required");
  }

  const result = await pool.query<ActivityRow>(
    `INSERT INTO activities (
       type, lead_id, opportunity_id, assigned_to, subject, due_date, status,
       details, latitude, longitude, external_ref_id, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7,'pending'), COALESCE($8,'{}'::jsonb), $9,$10,$11,$12)
     RETURNING *`,
    [
      input.type,
      leadId,
      opportunityId,
      input.assignedTo ?? requestingUserId,
      input.subject ?? null,
      input.dueDate ?? null,
      input.status ?? null,
      input.details ? JSON.stringify(input.details) : null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.externalRefId ?? null,
      requestingUserId,
    ]
  );

  return toPublicActivity(result.rows[0]);
}

export async function createActivityForLead(leadId: string, input: ActivityInput, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }
  return insertActivity(input, requestingUserId, leadId, null);
}

export async function createActivityForOpportunity(
  opportunityId: string,
  input: ActivityInput,
  requestingUserId: string
) {
  const visible = await isOpportunityVisibleToUser(opportunityId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }
  return insertActivity(input, requestingUserId, null, opportunityId);
}

export async function listActivitiesForLead(leadId: string, requestingUserId: string) {
  const visible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query<ActivityRow>(
    "SELECT * FROM activities WHERE lead_id = $1 ORDER BY created_at DESC",
    [leadId]
  );
  return result.rows.map(toPublicActivity);
}

export async function listActivitiesForOpportunity(opportunityId: string, requestingUserId: string) {
  const visible = await isOpportunityVisibleToUser(opportunityId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  const result = await pool.query<ActivityRow>(
    "SELECT * FROM activities WHERE opportunity_id = $1 ORDER BY created_at DESC",
    [opportunityId]
  );
  return result.rows.map(toPublicActivity);
}

export async function listActivitiesForUser(requestingUserId: string, filters: ListActivitiesFilters) {
  const conditions: string[] = ["l.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(`(
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
  )`);

  if (filters.type) {
    params.push(filters.type);
    conditions.push(`a.type = $${params.length}`);
  }
  if (filters.leadId) {
    params.push(filters.leadId);
    conditions.push(`a.lead_id = $${params.length}`);
  }
  if (filters.opportunityId) {
    params.push(filters.opportunityId);
    conditions.push(`a.opportunity_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`a.assigned_to = $${params.length}`);
  }

  params.push(filters.limit, (filters.page - 1) * filters.limit);

  const result = await pool.query<ActivityRow>(
    `${SUBTREE_CTE}
     SELECT a.* FROM activities a
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     JOIN leads l ON l.id = COALESCE(a.lead_id, o.lead_id)
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows.map(toPublicActivity);
}

export async function getActivityById(id: string, requestingUserId: string) {
  const visible = await isActivityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  const result = await pool.query<ActivityRow>("SELECT * FROM activities WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Activity not found");
  }
  return toPublicActivity(result.rows[0]);
}

export async function updateActivity(id: string, updates: ActivityInput, requestingUserId: string) {
  const visible = await isActivityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  const fieldMap: Record<string, unknown> = {
    subject: updates.subject,
    due_date: updates.dueDate,
    status: updates.status,
    assigned_to: updates.assignedTo,
    details: updates.details ? JSON.stringify(updates.details) : undefined,
    latitude: updates.latitude,
    longitude: updates.longitude,
    external_ref_id: updates.externalRefId,
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
    return getActivityById(id, requestingUserId);
  }

  setClauses.push("updated_at = now()");
  params.push(id);

  const result = await pool.query<ActivityRow>(
    `UPDATE activities SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return toPublicActivity(result.rows[0]);
}

export async function deleteActivity(id: string, requestingUserId: string): Promise<void> {
  const visible = await isActivityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  await pool.query("DELETE FROM activities WHERE id = $1", [id]);
}

export async function addComment(activityId: string, comment: string, userId: string) {
  const visible = await isActivityVisibleToUser(activityId, userId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  const result = await pool.query<CommentRow>(
    "INSERT INTO activity_comments (activity_id, user_id, comment) VALUES ($1, $2, $3) RETURNING *",
    [activityId, userId, comment]
  );

  return toPublicComment(result.rows[0]);
}

export async function listComments(activityId: string, requestingUserId: string) {
  const visible = await isActivityVisibleToUser(activityId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  const result = await pool.query<CommentRow>(
    "SELECT * FROM activity_comments WHERE activity_id = $1 ORDER BY created_at ASC",
    [activityId]
  );

  return result.rows.map(toPublicComment);
}
