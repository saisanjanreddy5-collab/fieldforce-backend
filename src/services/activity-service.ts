import { pool } from "../config/db";
import { ApiError } from "../utils/api-error";
import { withAdvisoryLock } from "../utils/db-lock";
import { BUSINESS_TIMEZONE } from "../utils/business-time";
import { isLeadInOwnerScope, isLeadVisibleToUser } from "./lead-service";
import { isOpportunityVisibleToUser } from "./opportunity-service";
import { SUBTREE_CTE } from "../utils/subtree";

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
  // Only present on queries that explicitly join it in (listActivitiesForLead,
  // for the Lead History tab's "who did this" requirement) - undefined
  // everywhere else, which toPublicActivity below treats the same as null.
  created_by_name?: string | null;
}

interface CommentRow {
  id: string;
  activity_id: string;
  user_id: string | null;
  comment: string;
  created_at: string;
  // Same deal as ActivityRow.created_by_name above - only joined in by
  // listCommentsForActivities.
  user_name?: string | null;
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
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublicComment(row: CommentRow) {
  return {
    id: row.id,
    activityId: row.activity_id,
    userId: row.user_id,
    userName: row.user_name ?? null,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

// Who can see an activity (alias a, its lead l, requesting user $1). Same
// as the lead rules, plus two things the lead rules alone missed:
//  - your OWN activities (you created it, or it's assigned to you) - a
//    Call Center rep who logs a callback on a teammate's lead must still
//    see it in their own queue and calendar;
//  - Admins see every activity, matching how leads/opportunities/quotes
//    already treat Admin as company-wide (not just their own reporting
//    subtree, which may be empty).
// Shared with call-center-service.ts so the two can't drift apart again.
export const ACTIVITY_VISIBILITY_CLAUSE = `(
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
    OR a.created_by = $1
    OR a.assigned_to = $1
    OR EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin')
  )`;

export async function isActivityVisibleToUser(activityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM activities a
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     JOIN leads l ON l.id = COALESCE(a.lead_id, o.lead_id)
     WHERE a.id = $2
       AND a.is_deleted = false
       AND l.is_deleted = false
       AND ${ACTIVITY_VISIBILITY_CLAUSE}`,
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
       AND a.is_deleted = false
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR a.created_by = $1
         OR EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin')
       )`,
    [userId, activityId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Mirrors the frontend's TYPE_LABEL (utils/activity-shared.tsx) just well
// enough to name the conflicting activity in a clear error message below -
// not meant to be the source of truth for display labels anywhere else.
const TYPE_LABEL: Record<string, string> = {
  call: "call",
  email: "email",
  teams_meeting: "meeting",
  site_visit: "site visit",
  whatsapp: "WhatsApp message",
  internal: "internal action",
};

// ---- Scheduling clashes (checked on create, reschedule and reassign) ----
//
// 1. One person, one slot: calls, Teams meetings and site visits occupy the
//    assigned person's time (their own durationMinutes, else a default
//    length), so a second one that overlaps is refused - whichever lead or
//    opportunity it is for. One person can't be on two calls at 12:00.
// 2. Same lead/opportunity, same kind of activity within 15 minutes is a
//    duplicate - two reps both booked to visit the same client at the same
//    hour - for every type.
// Finished (completed/cancelled) activities never count. The refusal names
// the clash and suggests the person's next free time.
const TIME_BOUND_DEFAULT_MINUTES: Record<string, number> = { call: 15, teams_meeting: 30, site_visit: 60 };
const DUPLICATE_WINDOW_MINUTES = 15;

// SQL for an existing activity's end time, matching durationOf() below.
const ACTIVITY_END_SQL = `a.due_date + make_interval(mins => CASE
    WHEN a.details->>'durationMinutes' ~ '^[0-9]+$' AND (a.details->>'durationMinutes')::int > 0 THEN (a.details->>'durationMinutes')::int
    WHEN a.type = 'teams_meeting' THEN 30
    WHEN a.type = 'site_visit' THEN 60
    ELSE 15 END)`;

function durationOf(type: string, details?: Record<string, unknown> | null): number {
  const own = Number(details?.durationMinutes);
  return Number.isInteger(own) && own > 0 ? own : TIME_BOUND_DEFAULT_MINUTES[type] ?? 15;
}

const formatTime = (date: Date) =>
  date.toLocaleString("en-IN", { timeZone: BUSINESS_TIMEZONE, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export interface SlotRequest {
  activityId?: string; // when rescheduling, never clashes with itself
  type: string;
  status: string;
  dueDate: string | null;
  assigneeId: string;
  leadId: string | null;
  opportunityId: string | null;
  details?: Record<string, unknown> | null;
}

export async function assertSlotIsFree(req: SlotRequest): Promise<void> {
  if (!req.dueDate || req.status === "completed" || req.status === "cancelled") return;
  const start = new Date(req.dueDate);
  const excludeId = req.activityId ?? null;

  // Rule 2: the same lead/opportunity already has this kind of activity then.
  const scopeColumn = req.leadId ? "lead_id" : "opportunity_id";
  const scopeId = req.leadId ?? req.opportunityId;
  if (scopeId) {
    const duplicate = await pool.query<{ due_date: string; assigned_to_name: string | null }>(
      `SELECT a.due_date, u.name AS assigned_to_name
       FROM activities a
       LEFT JOIN users u ON u.id = a.assigned_to
       WHERE a.${scopeColumn} = $1 AND a.type = $2
         AND a.is_deleted = false AND a.status NOT IN ('completed', 'cancelled') AND a.due_date IS NOT NULL
         AND a.due_date BETWEEN $3::timestamptz - make_interval(mins => ${DUPLICATE_WINDOW_MINUTES})
                            AND $3::timestamptz + make_interval(mins => ${DUPLICATE_WINDOW_MINUTES})
         AND ($4::uuid IS NULL OR a.id <> $4)
       LIMIT 1`,
      [scopeId, req.type, start.toISOString(), excludeId]
    );
    const existing = duplicate.rows[0];
    if (existing) {
      const label = TYPE_LABEL[req.type] ?? req.type;
      const forWhom = existing.assigned_to_name ? ` for ${existing.assigned_to_name}` : "";
      const message = `This ${req.leadId ? "lead" : "opportunity"} already has a ${label} scheduled${forWhom} at ${formatTime(new Date(existing.due_date))} - reschedule or cancel that one before adding another at the same time.`;
      throw new ApiError(409, message, { dueDate: [message] });
    }
  }

  // Rule 1: the person is already busy then.
  if (!(req.type in TIME_BOUND_DEFAULT_MINUTES)) return;
  const minutes = durationOf(req.type, req.details);
  const busy = await pool.query<{ type: string; start_at: Date; end_at: Date; lead_name: string | null; person: string | null }>(
    `SELECT a.type, a.due_date AS start_at, ${ACTIVITY_END_SQL} AS end_at,
            COALESCE(l.full_name, ol.full_name) AS lead_name, u.name AS person
     FROM activities a
     LEFT JOIN leads l ON l.id = a.lead_id
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     LEFT JOIN leads ol ON ol.id = o.lead_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.assigned_to = $1
       AND a.type IN ('call', 'teams_meeting', 'site_visit')
       AND a.is_deleted = false AND a.status NOT IN ('completed', 'cancelled') AND a.due_date IS NOT NULL
       AND ($2::uuid IS NULL OR a.id <> $2)
       AND a.due_date < $3::timestamptz + interval '2 days'
       AND ${ACTIVITY_END_SQL} > $3::timestamptz - interval '1 day'
     ORDER BY a.due_date`,
    [req.assigneeId, excludeId, start.toISOString()]
  );
  const end = new Date(start.getTime() + minutes * 60_000);
  const clash = busy.rows.find((b) => new Date(b.start_at) < end && new Date(b.end_at) > start);
  if (!clash) return;

  // Next free time: step past whatever overlaps until a gap of this length opens up.
  let candidate = start;
  for (let i = 0; i < 50; i++) {
    const candidateEnd = new Date(candidate.getTime() + minutes * 60_000);
    const overlapping = busy.rows.filter((b) => new Date(b.start_at) < candidateEnd && new Date(b.end_at) > candidate);
    if (overlapping.length === 0) break;
    candidate = new Date(Math.max(...overlapping.map((b) => new Date(b.end_at).getTime())));
  }

  const who = clash.person ?? "This person";
  const what = TYPE_LABEL[clash.type] ?? clash.type;
  const withWhom = clash.lead_name ? ` with ${clash.lead_name}` : "";
  const message = `${who} already has a ${what}${withWhom} from ${formatTime(new Date(clash.start_at))} to ${formatTime(new Date(clash.end_at))}. The next free time is ${formatTime(candidate)}.`;
  throw new ApiError(409, message, { dueDate: [message], suggestedDueDate: [candidate.toISOString()] });
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

  const assigneeId = input.assignedTo ?? requestingUserId;
  // One booking at a time per person, so two people scheduling the same
  // person at the same moment can't both pass the clash check.
  return withAdvisoryLock(`activity-slots:${assigneeId}`, async () => {
  await assertSlotIsFree({
    type: input.type!,
    status: input.status ?? "pending",
    dueDate: input.dueDate ?? null,
    assigneeId,
    leadId,
    opportunityId,
    details: input.details,
  });

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
  });
}

export async function createActivityForLead(leadId: string, input: ActivityInput, requestingUserId: string) {
  // Logging work on a lead needs real working access (owner/team scope) or
  // an explicit share - Call Center's company-wide *lookup* visibility of
  // leads that have already left their floor is read-only by design.
  const canWork = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!canWork) {
    const shared = await pool.query("SELECT 1 FROM lead_shares WHERE lead_id = $1 AND shared_with_user_id = $2", [leadId, requestingUserId]);
    if ((shared.rowCount ?? 0) === 0) {
      const visible = await isLeadVisibleToUser(leadId, requestingUserId);
      throw new ApiError(403, visible ? "You can view this lead but not log activities on it" : "You do not have access to this lead");
    }
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
    `SELECT a.*, u.name AS created_by_name FROM activities a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.lead_id = $1 AND a.is_deleted = false ORDER BY a.created_at DESC`,
    [leadId]
  );
  return result.rows.map(toPublicActivity);
}

// Bulk sibling of listActivitiesForLead - every activity for MANY leads in
// one query (used by the Leads export's History sheet), not one query per
// lead. No per-lead visibility check here, same reasoning as
// listCommentsForActivities below: the caller (lead-export-service.ts)
// already proved visibility via listLeadsForExport's own filtered query, so
// these ids are exactly the leads the requesting admin can already export.
export async function getBulkActivitiesForLeads(leadIds: string[]) {
  if (leadIds.length === 0) return [];
  const result = await pool.query<ActivityRow>(
    `SELECT a.*, u.name AS created_by_name FROM activities a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.lead_id = ANY($1) AND a.is_deleted = false ORDER BY a.lead_id, a.created_at DESC`,
    [leadIds]
  );
  return result.rows.map(toPublicActivity);
}

export async function listActivitiesForOpportunity(opportunityId: string, requestingUserId: string) {
  const visible = await isOpportunityVisibleToUser(opportunityId, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  const result = await pool.query<ActivityRow>(
    "SELECT * FROM activities WHERE opportunity_id = $1 AND is_deleted = false ORDER BY created_at DESC",
    [opportunityId]
  );
  return result.rows.map(toPublicActivity);
}

export async function listActivitiesForUser(requestingUserId: string, filters: ListActivitiesFilters) {
  const conditions: string[] = ["l.is_deleted = false", "a.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(ACTIVITY_VISIBILITY_CLAUSE);

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

  const result = await pool.query<ActivityRow>("SELECT * FROM activities WHERE id = $1 AND is_deleted = false", [id]);
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

  const current = (await pool.query<ActivityRow>("SELECT * FROM activities WHERE id = $1", [id])).rows[0];
  if (!current) throw new ApiError(404, "Activity not found");
  const assigneeId = updates.assignedTo ?? current.assigned_to ?? requestingUserId;
  // Rescheduling or reassigning gets the same clash check as creating.
  const movesSlot = updates.dueDate !== undefined || updates.assignedTo !== undefined || updates.details !== undefined || updates.status !== undefined;
  return withAdvisoryLock(`activity-slots:${assigneeId}`, async () => {
    if (movesSlot) {
      await assertSlotIsFree({
        activityId: id,
        type: current.type,
        status: updates.status ?? current.status,
        dueDate: updates.dueDate ?? current.due_date,
        assigneeId,
        leadId: current.lead_id,
        opportunityId: current.opportunity_id,
        details: updates.details ?? current.details,
      });
    }
    const result = await pool.query<ActivityRow>(
      `UPDATE activities SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    return toPublicActivity(result.rows[0]);
  });
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

// Archives, never permanently deletes - "data is king" - same is_deleted
// convention leads/opportunities already use. The row (and its history)
// stays in the database, just excluded from every list/get query above.
export async function deleteActivity(id: string, requestingUserId: string): Promise<void> {
  const inScope = await isActivityInOwnerScope(id, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this activity");
  }

  await pool.query("UPDATE activities SET is_deleted = true WHERE id = $1 AND is_deleted = false", [id]);
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

// No visibility check here, unlike listComments above - this is an internal
// helper only ever called from getLeadTimeline, which has already proven the
// caller can see the parent lead these activity ids belong to.
export async function listCommentsForActivities(activityIds: string[]) {
  if (activityIds.length === 0) return [];
  const result = await pool.query<CommentRow>(
    `SELECT c.*, u.name AS user_name FROM activity_comments c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.activity_id = ANY($1) ORDER BY c.created_at ASC`,
    [activityIds]
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
     LEFT JOIN activities a ON a.assigned_to = $1 AND a.is_deleted = false
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
     WHERE assigned_to = $1 AND is_deleted = false AND due_date >= $2::date AND due_date < ($3::date + interval '1 day')
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
       WHERE assigned_to = $1 AND is_deleted = false AND due_date >= $2::date AND due_date < ($3::date + interval '1 day')
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
