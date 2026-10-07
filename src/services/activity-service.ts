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

// Narrower than isActivityVisibleToUser: true only when the parent lead's
// (or, for opportunity-linked activities, the opportunity's lead's) owner is
// in the requesting user's subtree. Excludes lead_shares, mirroring
// isLeadInOwnerScope/isOpportunityInOwnerScope - visibility via a shared
// lead does not extend to updating/deleting that lead's activities.
export async function isActivityInOwnerScope(activityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM activities a
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     JOIN leads l ON l.id = COALESCE(a.lead_id, o.lead_id)
     WHERE a.id = $2
       AND l.is_deleted = false
       AND l.owner_id IN (SELECT id FROM subtree)`,
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
  const inScope = await isActivityInOwnerScope(id, requestingUserId);
  if (!inScope) {
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

// Called by the Smartflo webhook, which has no CRM user session - it
// identifies the call purely by the ref_id we stored as external_ref_id
// when the click-to-call was initiated, so there is no visibility check
// here (there is no requesting user to check visibility for).
export async function mergeActivityDetailsByExternalRefId(
  externalRefId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE activities
     SET details = details || $2::jsonb, updated_at = now()
     WHERE external_ref_id = $1
     RETURNING id`,
    [externalRefId, JSON.stringify(patch)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteActivity(id: string, requestingUserId: string): Promise<void> {
  const inScope = await isActivityInOwnerScope(id, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  await pool.query("DELETE FROM activities WHERE id = $1", [id]);
}

// Intentionally uses the broad view scope, not isActivityInOwnerScope.
// Commenting is treated as a collaborative action on a visible activity, not
// a modification of the activity's own core record (that's updateActivity/
// deleteActivity, which do require owner scope) - so anyone the activity is
// shared with can add a comment, same as they can view it.
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

// --- Activity calendar (Team nav) ---
// A calendar-shaped read layer over the same `activities` table above - not
// a parallel data model. For a manager or agent, "Calendar of" only ever
// lists their own direct reports (mirrors Leave/Expenses' direct-manager-
// only scoping, not the full recursive subtree leads/opportunities use).
// Admin is different on purpose: admin is a global role, not a node in the
// reporting chain, so admin accounts routinely have zero direct reports of
// their own (confirmed against this app's real seed data) even though
// admin already has full read access everywhere else in FieldForce - so an
// admin's "Calendar of" lists every other active user instead of their
// (always-empty) direct reports.
// Widened from direct reports only to the full reporting chain - same
// manager-subtree rule leads/opportunities/activities' own main list
// already uses, so a Zonal Head can open an indirect subordinate's
// calendar, not just a direct report's. The picker below and the access
// check both need to agree on this, or the UI would offer someone the
// backend then refuses.
export async function getCalendarTeam(userId: string, role: string) {
  if (role === "admin") {
    const result = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE id != $1 AND is_active = true ORDER BY name ASC",
      [userId]
    );
    return result.rows;
  }
  const result = await pool.query<{ id: string; name: string }>(
    `${SUBTREE_CTE} SELECT u.id, u.name FROM users u JOIN subtree s ON s.id = u.id WHERE u.id != $1 AND u.is_active = true ORDER BY u.name ASC`,
    [userId]
  );
  return result.rows;
}

async function assertCalendarAccess(requestingUserId: string, viewingUserId: string, requestingRole: string): Promise<void> {
  if (requestingUserId === viewingUserId || requestingRole === "admin") return;
  const result = await pool.query(`${SUBTREE_CTE} SELECT 1 FROM subtree WHERE id = $2`, [requestingUserId, viewingUserId]);
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(403, "You can only view your own calendar or someone in your reporting chain's");
  }
}

interface CalendarProfileRow {
  id: string;
  name: string;
  zone_name: string | null;
  office_name: string | null;
}

async function getCalendarProfile(userId: string): Promise<CalendarProfileRow> {
  const result = await pool.query<CalendarProfileRow>(
    `SELECT u.id, u.name, z.name AS zone_name, o.name AS office_name
     FROM users u
     LEFT JOIN zones z ON z.id = u.zone_id
     LEFT JOIN offices o ON o.id = u.office_id
     WHERE u.id = $1`,
    [userId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "User not found");
  }
  return result.rows[0];
}

interface CalendarStatsRow {
  scheduled_this_week: string;
  today_total: string;
  today_done: string;
  overdue_count: string;
  field_days_this_week: string;
}

// Anchored to the real current day/week in IST regardless of which
// day/week/month the calendar is currently displaying - the reference's
// stat cards never change when you switch Day/Week/Month tabs.
async function getCalendarStats(userId: string) {
  const result = await pool.query<CalendarStatsRow>(
    `WITH bounds AS (
       SELECT
         (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS week_start,
         (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') + interval '7 days' AS week_end,
         (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS day_start,
         (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') + interval '1 day' AS day_end
     )
     SELECT
       count(*) FILTER (WHERE a.due_date >= b.week_start AND a.due_date < b.week_end AND a.status <> 'cancelled') AS scheduled_this_week,
       count(*) FILTER (WHERE a.due_date >= b.day_start AND a.due_date < b.day_end) AS today_total,
       count(*) FILTER (WHERE a.due_date >= b.day_start AND a.due_date < b.day_end AND a.status = 'completed') AS today_done,
       count(*) FILTER (WHERE a.due_date < now() AND a.status NOT IN ('completed','cancelled')) AS overdue_count,
       count(DISTINCT date_trunc('day', a.due_date AT TIME ZONE 'Asia/Kolkata'))
         FILTER (WHERE a.type = 'site_visit' AND a.due_date >= b.week_start AND a.due_date < b.week_end) AS field_days_this_week
     FROM bounds b
     LEFT JOIN activities a ON a.assigned_to = $1
     GROUP BY b.week_start, b.week_end, b.day_start, b.day_end`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return { scheduledThisWeek: 0, todayTotal: 0, todayDone: 0, overdueCount: 0, fieldDaysThisWeek: 0 };
  }
  return {
    scheduledThisWeek: Number(row.scheduled_this_week),
    todayTotal: Number(row.today_total),
    todayDone: Number(row.today_done),
    overdueCount: Number(row.overdue_count),
    fieldDaysThisWeek: Number(row.field_days_this_week),
  };
}

export type CalendarDayTag = "field" | "office" | "off";

// A day is tagged from what actually happened first (any activity that day
// beats a leave record for it), and only falls back to "off" from approved
// leave when there is no activity evidence either way - see the reasoning
// in the PR description, not repeated here.
async function getCalendarDayTags(userId: string, from: string, to: string): Promise<Record<string, CalendarDayTag>> {
  const activityDays = await pool.query<{ day: string; has_site_visit: boolean }>(
    `SELECT date_trunc('day', due_date AT TIME ZONE 'Asia/Kolkata')::date AS day, bool_or(type = 'site_visit') AS has_site_visit
     FROM activities
     WHERE assigned_to = $1 AND due_date >= $2::date AND due_date < ($3::date + interval '1 day')
     GROUP BY 1`,
    [userId, from, to]
  );

  const leaveRanges = await pool.query<{ start_date: string; end_date: string }>(
    `SELECT start_date, end_date FROM leave_requests
     WHERE user_id = $1 AND status = 'approved' AND start_date <= $3::date AND end_date >= $2::date`,
    [userId, from, to]
  );

  const toUTCDate = (dateStr: string) => {
    const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

  const tags: Record<string, CalendarDayTag> = {};
  for (const range of leaveRanges.rows) {
    const cursor = toUTCDate(range.start_date);
    const end = toUTCDate(range.end_date);
    while (cursor.getTime() <= end.getTime()) {
      tags[toDateKey(cursor)] = "off";
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  for (const row of activityDays.rows) {
    tags[toDateKey(toUTCDate(row.day))] = row.has_site_visit ? "field" : "office";
  }
  return tags;
}

export interface CalendarView {
  user: { id: string; name: string; zoneName: string | null; officeName: string | null };
  msSyncedAt: string | null;
  activities: ReturnType<typeof toPublicActivity>[];
  stats: Awaited<ReturnType<typeof getCalendarStats>>;
  dayTags: Record<string, CalendarDayTag>;
}

export async function getCalendarView(
  requestingUserId: string,
  requestingRole: string,
  viewingUserIdParam: string | undefined,
  from: string,
  to: string
): Promise<CalendarView> {
  const viewingUserId = viewingUserIdParam ?? requestingUserId;
  await assertCalendarAccess(requestingUserId, viewingUserId, requestingRole);

  const [profile, msConnection, activitiesResult, stats, dayTags] = await Promise.all([
    getCalendarProfile(viewingUserId),
    pool.query<{ updated_at: string }>("SELECT updated_at FROM microsoft_connections WHERE user_id = $1", [
      viewingUserId,
    ]),
    pool.query<ActivityRow>(
      `SELECT * FROM activities
       WHERE assigned_to = $1 AND due_date >= $2::date AND due_date < ($3::date + interval '1 day')
       ORDER BY due_date ASC`,
      [viewingUserId, from, to]
    ),
    getCalendarStats(viewingUserId),
    getCalendarDayTags(viewingUserId, from, to),
  ]);

  return {
    user: { id: profile.id, name: profile.name, zoneName: profile.zone_name, officeName: profile.office_name },
    msSyncedAt: msConnection.rows[0]?.updated_at ?? null,
    activities: activitiesResult.rows.map(toPublicActivity),
    stats,
    dayTags,
  };
}
