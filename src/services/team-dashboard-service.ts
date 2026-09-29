import { pool } from "../config/db";

// Direct reports only (+ the requesting manager themselves as the first
// row) - same "reporting manager" framing Leave/Expense approvals already
// use, not the full recursive subtree leads/opportunities use. Admin is
// different on purpose, same reasoning as activity-service.ts's
// getCalendarTeam: admin routinely has zero direct reports in real seed
// data, so admin's team is every other active user instead.
async function getTeamMemberIds(requestingUserId: string, requestingRole: string) {
  const query =
    requestingRole === "admin"
      ? `SELECT id, name, territory FROM users WHERE is_active = true ORDER BY (id = $1) DESC, name ASC`
      : `SELECT id, name, territory FROM users WHERE is_active = true AND (id = $1 OR manager_id = $1) ORDER BY (id = $1) DESC, name ASC`;
  const result = await pool.query<{ id: string; name: string; territory: string | null }>(query, [requestingUserId]);
  return result.rows;
}

export type TeamDayTag = "field" | "office" | "leave" | "weekly_off" | "none";

export interface TeamMemberAvailability {
  id: string;
  name: string;
  territory: string | null;
  days: { date: string; tag: TeamDayTag }[];
  loadThisWeek: number;
}

export interface TeamDashboardStats {
  headcount: number;
  availableToday: number;
  onLeaveToday: number;
  onLeaveUnapprovedToday: number;
  fieldVisitsToday: number;
  fieldVisitsPendingToday: number;
  avgActivitiesPerPerson: number;
  avgActivitiesPerPersonLastWeek: number;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

async function getWeekStart(): Promise<string> {
  const result = await pool.query<{ week_start: string }>(
    `SELECT to_char(date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS week_start`
  );
  return result.rows[0].week_start;
}

async function getToday(): Promise<string> {
  const result = await pool.query<{ today: string }>(
    `SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS today`
  );
  return result.rows[0].today;
}

export async function getTeamAvailability(requestingUserId: string, requestingRole: string) {
  const members = await getTeamMemberIds(requestingUserId, requestingRole);
  const userIds = members.map((m) => m.id);
  const headcount = userIds.length;

  const emptyStats: TeamDashboardStats = {
    headcount,
    availableToday: headcount,
    onLeaveToday: 0,
    onLeaveUnapprovedToday: 0,
    fieldVisitsToday: 0,
    fieldVisitsPendingToday: 0,
    avgActivitiesPerPerson: 0,
    avgActivitiesPerPersonLastWeek: 0,
  };
  if (headcount === 0) return { team: [] as TeamMemberAvailability[], weekStart: await getWeekStart(), stats: emptyStats };

  const weekStart = await getWeekStart();
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEndExclusive = addDays(weekStart, 7);
  const today = await getToday();

  // Real activity per user/day this week - same site_visit-vs-other
  // distinction activity-service.ts's getCalendarDayTags already uses for
  // the single-user Activity Calendar, just batched across the whole team
  // in one query instead of one call per person.
  const activityResult = await pool.query<{ user_id: string; day: string; has_site_visit: boolean; count: string }>(
    `SELECT assigned_to AS user_id, to_char(date_trunc('day', due_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
       bool_or(type = 'site_visit') AS has_site_visit, count(*) AS count
     FROM activities
     WHERE assigned_to = ANY($1) AND due_date >= $2::date AND due_date < $3::date AND status <> 'cancelled'
     GROUP BY assigned_to, 2`,
    [userIds, weekStart, weekEndExclusive]
  );

  // Real approved leave overlapping this week, for these same users
  const leaveResult = await pool.query<{ user_id: string; start_date: string; end_date: string }>(
    `SELECT user_id, start_date, end_date FROM leave_requests
     WHERE user_id = ANY($1) AND status = 'approved' AND start_date < $3::date AND end_date >= $2::date`,
    [userIds, weekStart, weekEndExclusive]
  );

  const activityByUserDay = new Map<string, { hasSiteVisit: boolean; count: number }>();
  for (const row of activityResult.rows) {
    activityByUserDay.set(`${row.user_id}:${row.day}`, { hasSiteVisit: row.has_site_visit, count: Number(row.count) });
  }
  const weekLastDay = weekDates[6];
  const leaveDaysByUser = new Map<string, Set<string>>();
  for (const row of leaveResult.rows) {
    const start = row.start_date.slice(0, 10);
    const end = row.end_date.slice(0, 10);
    // Clamp the leave range to the 7 real dates being rendered - a leave
    // request spanning outside this week shouldn't extend the set past it.
    let cursor = start < weekStart ? weekStart : start;
    const clampedEnd = end > weekLastDay ? weekLastDay : end;
    const set = leaveDaysByUser.get(row.user_id) ?? new Set<string>();
    while (cursor <= clampedEnd) {
      set.add(cursor);
      cursor = addDays(cursor, 1);
    }
    leaveDaysByUser.set(row.user_id, set);
  }

  // Sat/Sun are already the real "non-working day" convention leave-service.ts's
  // countWorkingDays() encodes (excluded from every working-day calculation
  // in the Leave module) - reused here rather than inventing a new one.
  const isWeeklyOff = (dateStr: string) => {
    const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    return dow === 0 || dow === 6;
  };

  const team: TeamMemberAvailability[] = members.map((m) => {
    let loadThisWeek = 0;
    const days = weekDates.map((date) => {
      const activity = activityByUserDay.get(`${m.id}:${date}`);
      if (activity) loadThisWeek += activity.count;
      const onLeave = leaveDaysByUser.get(m.id)?.has(date) ?? false;

      let tag: TeamDayTag;
      if (onLeave) tag = "leave";
      else if (activity?.hasSiteVisit) tag = "field";
      else if (activity) tag = "office";
      else if (isWeeklyOff(date)) tag = "weekly_off";
      else tag = "none";

      return { date, tag };
    });
    return { id: m.id, name: m.name, territory: m.territory, days, loadThisWeek };
  });

  // Stats - all real, computed independently of the per-day grid above so a
  // grid-building bug can never silently skew the headline numbers.
  const [approvedLeaveToday, pendingLeaveToday, fieldVisitsToday, thisWeekTotal, lastWeekTotal] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) AS count FROM leave_requests
       WHERE user_id = ANY($1) AND status = 'approved' AND start_date <= $2::date AND end_date >= $2::date`,
      [userIds, today]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) AS count FROM leave_requests
       WHERE user_id = ANY($1) AND status = 'pending' AND start_date <= $2::date AND end_date >= $2::date`,
      [userIds, today]
    ),
    pool.query<{ total: string; pending: string }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) AS pending
       FROM activities
       WHERE assigned_to = ANY($1) AND type = 'site_visit'
         AND due_date >= $2::date AND due_date < $2::date + interval '1 day'`,
      [userIds, today]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM activities
       WHERE assigned_to = ANY($1) AND due_date >= $2::date AND due_date < $3::date AND status <> 'cancelled'`,
      [userIds, weekStart, weekEndExclusive]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM activities
       WHERE assigned_to = ANY($1) AND due_date >= $2::date - interval '7 days' AND due_date < $2::date AND status <> 'cancelled'`,
      [userIds, weekStart]
    ),
  ]);

  const onLeaveToday = Number(approvedLeaveToday.rows[0].count);
  const stats: TeamDashboardStats = {
    headcount,
    availableToday: headcount - onLeaveToday,
    onLeaveToday,
    onLeaveUnapprovedToday: Number(pendingLeaveToday.rows[0].count),
    fieldVisitsToday: Number(fieldVisitsToday.rows[0].total),
    fieldVisitsPendingToday: Number(fieldVisitsToday.rows[0].pending),
    avgActivitiesPerPerson: Math.round((Number(thisWeekTotal.rows[0].count) / headcount) * 10) / 10,
    avgActivitiesPerPersonLastWeek: Math.round((Number(lastWeekTotal.rows[0].count) / headcount) * 10) / 10,
  };

  return { team, weekStart, stats };
}
