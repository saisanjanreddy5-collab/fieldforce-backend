import { pool } from "../config/db";
import { withAdvisoryLock } from "../utils/db-lock";
import { ApiError } from "../utils/api-error";
import { recordAuditEvent } from "./audit-log-service";
import { Role, ROLES } from "../utils/roles";
import { SUBTREE_CTE } from "../utils/subtree";

const LEAVE_TYPE_KEYS = ["casual", "sick", "earned", "comp_off"] as const;
export type LeaveTypeKey = (typeof LEAVE_TYPE_KEYS)[number];
export const LEAVE_REQUEST_KINDS = ["casual", "sick", "earned", "comp_off", "half_day", "wfh"] as const;
export type LeaveRequestKind = (typeof LEAVE_REQUEST_KINDS)[number];

// Only these four actually draw down a real entitlement/credit balance -
// half_day and wfh are tracked the same way (submitted, approved, blocks
// the calendar) purely for team visibility, with no leave_types row and no
// balance to check against.
const ENTITLEMENT_KINDS: readonly string[] = ["casual", "sick", "earned", "comp_off"];

interface LeaveTypeRow {
  id: string;
  key: LeaveTypeKey;
  label: string;
  color: string;
  annual_days: string | null;
  accrual_per_month: string | null;
  carry_forward_cap: string | null;
  max_consecutive_days: number | null;
  notice_days: number | null;
  medical_note_after_days: number | null;
  expires_after_days: number | null;
  requires_second_approver: boolean;
  policy_note: string;
  sort_order: number;
}

interface LeaveRequestRow {
  id: string;
  user_id: string;
  kind: LeaveRequestKind;
  start_date: string;
  end_date: string;
  days_count: string;
  reason: string;
  cover_user_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approver_id: string | null;
  approver_decision: "approved" | "rejected" | null;
  approver_decided_at: string | null;
  second_approver_id: string | null;
  second_approver_decision: "approved" | "rejected" | null;
  second_approver_decided_at: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  cover_user_name?: string | null;
  approver_name?: string | null;
  second_approver_name?: string | null;
}

export interface CreateLeaveRequestInput {
  kind: LeaveRequestKind;
  startDate: string;
  endDate: string;
  reason: string;
  coverUserId?: string;
}

export interface GrantCompOffInput {
  userId: string;
  earnedDate: string;
  reason?: string;
}

function toPublicLeaveType(row: LeaveTypeRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    color: row.color,
    annualDays: row.annual_days === null ? null : Number(row.annual_days),
    accrualPerMonth: row.accrual_per_month === null ? null : Number(row.accrual_per_month),
    carryForwardCap: row.carry_forward_cap === null ? null : Number(row.carry_forward_cap),
    maxConsecutiveDays: row.max_consecutive_days,
    noticeDays: row.notice_days,
    medicalNoteAfterDays: row.medical_note_after_days,
    expiresAfterDays: row.expires_after_days,
    requiresSecondApprover: row.requires_second_approver,
    policyNote: row.policy_note,
    approverNote: row.requires_second_approver ? "Approved by manager + skip level" : "Approved by reporting manager",
  };
}

function toPublicLeaveRequest(row: LeaveRequestRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? null,
    kind: row.kind,
    startDate: row.start_date,
    endDate: row.end_date,
    daysCount: Number(row.days_count),
    reason: row.reason,
    coverUserId: row.cover_user_id,
    coverUserName: row.cover_user_name ?? null,
    status: row.status,
    approverId: row.approver_id,
    approverName: row.approver_name ?? null,
    approverDecision: row.approver_decision,
    approverDecidedAt: row.approver_decided_at,
    secondApproverId: row.second_approver_id,
    secondApproverName: row.second_approver_name ?? null,
    secondApproverDecision: row.second_approver_decision,
    secondApproverDecidedAt: row.second_approver_decided_at,
    createdAt: row.created_at,
  };
}

async function listLeaveTypes() {
  const result = await pool.query<LeaveTypeRow>("SELECT * FROM leave_types ORDER BY sort_order ASC");
  return result.rows.map(toPublicLeaveType);
}

export interface ListLeaveTypesFilters {
  page: number;
  limit: number;
}

// Separate from listLeaveTypes() above - that unpaginated helper is still
// relied on internally by getBalances() below, which needs every real leave
// type to build one balance entry per type, never a single page of them.
// This one backs the GET /leave/types list endpoint only.
export async function listLeaveTypesPaginated(filters: ListLeaveTypesFilters) {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM leave_types");

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const result = await pool.query<LeaveTypeRow>(
    "SELECT * FROM leave_types ORDER BY sort_order ASC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return { leaveTypes: result.rows.map(toPublicLeaveType), total: Number(countResult.rows[0].count) };
}

export interface UpdateLeaveTypeInput {
  annualDays?: number | null;
  accrualPerMonth?: number | null;
  carryForwardCap?: number | null;
  maxConsecutiveDays?: number | null;
  noticeDays?: number | null;
  medicalNoteAfterDays?: number | null;
  expiresAfterDays?: number | null;
  requiresSecondApprover?: boolean;
  policyNote?: string;
}

// Settings > Leave types - admin-only edit of the same leave_types row every
// balance/notice-days/approval-routing calculation already reads from, so a
// policy change here takes effect immediately for every future request
// without needing a code change or redeploy.
export async function updateLeaveType(key: LeaveTypeKey, updates: UpdateLeaveTypeInput) {
  const fieldMap: Record<string, unknown> = {
    annual_days: updates.annualDays,
    accrual_per_month: updates.accrualPerMonth,
    carry_forward_cap: updates.carryForwardCap,
    max_consecutive_days: updates.maxConsecutiveDays,
    notice_days: updates.noticeDays,
    medical_note_after_days: updates.medicalNoteAfterDays,
    expires_after_days: updates.expiresAfterDays,
    requires_second_approver: updates.requiresSecondApprover,
    policy_note: updates.policyNote,
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
    return toPublicLeaveType(await getLeaveTypeByKey(key));
  }

  setClauses.push("updated_at = now()");
  params.push(key);

  const result = await pool.query<LeaveTypeRow>(
    `UPDATE leave_types SET ${setClauses.join(", ")} WHERE key = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, `Leave type '${key}' is not configured`);
  }
  return toPublicLeaveType(result.rows[0]);
}

async function getLeaveTypeByKey(key: LeaveTypeKey): Promise<LeaveTypeRow> {
  const result = await pool.query<LeaveTypeRow>("SELECT * FROM leave_types WHERE key = $1", [key]);
  if (result.rows.length === 0) {
    throw new ApiError(500, `Leave type '${key}' is not configured`);
  }
  return result.rows[0];
}

// Saturdays/Sundays don't count against any leave balance - matches the
// Team leave legend's "Weekly offs are not shown" framing (a weekly off
// isn't a leave day at all, so it's never counted as one here either).
function countWorkingDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

async function isAdminUser(userId: string): Promise<boolean> {
  const result = await pool.query<{ role: string }>("SELECT role FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.role === ROLES.ADMIN;
}


// An approver nobody can rely on: missing, deactivated, or whose role doesn't
// hold the approve permission (any user can be picked as someone's
// manager). Requests waiting on such a person go to every Admin instead of
// sitting pending forever.
function approverCannotActSql(column: string): string {
  return `(${column} IS NULL OR EXISTS (SELECT 1 FROM users au WHERE au.id = ${column} AND (au.is_active = false OR NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = au.role AND rp.permission = 'leave_requests.approve'))))`;
}

async function approverCannotAct(approverId: string | null): Promise<boolean> {
  const result = await pool.query<{ gone: boolean }>(`SELECT ${approverCannotActSql("$1::uuid")} AS gone`, [approverId]);
  return result.rows[0].gone;
}

// Whether another active Admin exists who can decide (or pay) this
// person's own request.
async function anotherActiveAdminExists(userId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM users WHERE role = $1 AND is_active = true AND id <> $2 LIMIT 1", [ROLES.ADMIN, userId]);
  return (result.rowCount ?? 0) > 0;
}

async function getDirectManagerId(userId: string): Promise<string | null> {
  const result = await pool.query<{ manager_id: string | null }>("SELECT manager_id FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.manager_id ?? null;
}

// One balance entry per real leave type - entitlement/used/available for
// casual & sick, an accrual-prorated available for earned (accrues
// gradually through the year rather than all being available on day one),
// and an earned-vs-used running total for comp off, which has no fixed
// annual number at all.
export async function getBalances(userId: string) {
  const types = await listLeaveTypes();
  const currentYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;

  const balances = await Promise.all(
    types.map(async (type) => {
      if (type.key === "comp_off") {
        // Each comp-off day taken is drawn from a credit that was actually
        // valid on that day (earned on/before it, not yet expired), soonest
        // expiry first. Charging it to just any credit - e.g. one that had
        // already expired unused - would leave a newer credit untouched and
        // hand out a free extra day.
        const creditsResult = await pool.query<{ days: string; earned_date: string; expires_at: string; expired: boolean }>(
          "SELECT days, earned_date, expires_at, expires_at < CURRENT_DATE AS expired FROM comp_off_credits WHERE user_id = $1 ORDER BY expires_at ASC, earned_date ASC",
          [userId]
        );
        const takenResult = await pool.query<{ start_date: string; days_count: string }>(
          "SELECT start_date, days_count FROM leave_requests WHERE user_id = $1 AND kind = 'comp_off' AND status = 'approved' ORDER BY start_date ASC",
          [userId]
        );
        const credits = creditsResult.rows.map((c) => ({ ...c, left: Number(c.days) }));
        let used = 0;
        for (const taken of takenResult.rows) {
          let need = Number(taken.days_count);
          used += need;
          for (const credit of credits) {
            if (need <= 0) break;
            const validThatDay = credit.earned_date <= taken.start_date && credit.expires_at >= taken.start_date;
            if (!validThatDay || credit.left <= 0) continue;
            const drawn = Math.min(credit.left, need);
            credit.left -= drawn;
            need -= drawn;
          }
        }
        const live = credits.filter((c) => !c.expired);
        const earned = live.reduce((sum, c) => sum + Number(c.days), 0);
        const available = live.reduce((sum, c) => sum + c.left, 0);
        return { ...type, entitlement: null, used, available, earned };
      }

      const usedResult = await pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(days_count), 0) AS total FROM leave_requests
         WHERE user_id = $1 AND kind = $2 AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $3`,
        [userId, type.key, currentYear]
      );
      const used = Number(usedResult.rows[0].total);

      // Earned leave accrues 1.5/month rather than being available in full
      // from January 1st - every other entitled type is a flat annual grant.
      const entitlement =
        type.key === "earned" && type.accrualPerMonth !== null
          ? Math.min(type.annualDays ?? Infinity, Math.round(type.accrualPerMonth * currentMonth * 10) / 10)
          : type.annualDays;

      return { ...type, entitlement, used, available: entitlement === null ? null : Math.max(0, entitlement - used), earned: null };
    })
  );

  return balances;
}

const REQUEST_SELECT = `
  SELECT lr.*, u.name AS user_name, cu.name AS cover_user_name,
    av.name AS approver_name, sav.name AS second_approver_name
  FROM leave_requests lr
  JOIN users u ON u.id = lr.user_id
  LEFT JOIN users cu ON cu.id = lr.cover_user_id
  LEFT JOIN users av ON av.id = lr.approver_id
  LEFT JOIN users sav ON sav.id = lr.second_approver_id
`;

export async function listMyRequests(userId: string) {
  const result = await pool.query<LeaveRequestRow>(`${REQUEST_SELECT} WHERE lr.user_id = $1 ORDER BY lr.created_at DESC`, [userId]);
  return result.rows.map(toPublicLeaveRequest);
}

// Direct reports only - Leave approval is by "the reporting manager", not
// the whole subtree, so this deliberately doesn't reuse the recursive
// subtree CTE the record-scope modules (leads/opportunities/activities) use.
// Admin is a global role, not a node in the reporting chain - admin
// accounts routinely have zero direct reports of their own (same fact
// team-rollup-service.ts's own getTeamRollup already documents), so the
// plain "WHERE u.manager_id = $1" below left an admin's own Team tab
// permanently empty, reading as "only my own leave list" even though every
// other screen already gives admin full company-wide visibility. Every
// other role keeps the direct-reports-only scope unchanged.
export async function listTeamRequests(managerId: string, requestingRole: Role) {
  const whereClause =
    requestingRole === ROLES.ADMIN
      ? `lr.start_date <= CURRENT_DATE + INTERVAL '30 days' AND lr.end_date >= CURRENT_DATE AND lr.status != 'cancelled'`
      : `u.manager_id = $1 AND lr.start_date <= CURRENT_DATE + INTERVAL '30 days' AND lr.end_date >= CURRENT_DATE AND lr.status != 'cancelled'`;
  const params = requestingRole === ROLES.ADMIN ? [] : [managerId];

  const result = await pool.query<LeaveRequestRow>(
    `${REQUEST_SELECT}
     WHERE ${whereClause}
     ORDER BY lr.start_date ASC`,
    params
  );
  return result.rows.map(toPublicLeaveRequest);
}

export interface SearchLeaveRequestsFilters {
  userId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

// The full reporting chain beneath the requester - not just direct reports
// (listTeamRequests above) and not just its fixed "next 30 days" window: any
// month, past or future, optionally one person.
// viewAll (leave_requests.view_all - Admins): every request in the company,
// not just the requester's reporting chain.
export async function searchLeaveRequests(requestingUserId: string, filters: SearchLeaveRequestsFilters, viewAll = false) {
  const conditions: string[] = [viewAll ? "true" : "u.id IN (SELECT id FROM subtree)"];
  const params: unknown[] = [requestingUserId];

  if (filters.userId) {
    params.push(filters.userId);
    conditions.push(`lr.user_id = $${params.length}`);
  }
  // Overlap test, same shape listTeamRequests already uses for its own
  // fixed window - a request overlaps the queried range as soon as it
  // starts on or before the range's end and ends on or after its start.
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`lr.end_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`lr.start_date <= $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE} SELECT COUNT(*) FROM leave_requests lr JOIN users u ON u.id = lr.user_id WHERE ${whereClause}`,
    params
  );

  const listParams = [...params, filters.limit, (filters.page - 1) * filters.limit];
  const result = await pool.query<LeaveRequestRow>(
    `${SUBTREE_CTE}
     ${REQUEST_SELECT}
     WHERE ${whereClause}
     ORDER BY lr.start_date DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { requests: result.rows.map(toPublicLeaveRequest), total: Number(countResult.rows[0].count) };
}

// Distinct from listTeamRequests (which is direct-reports-only, for the
// Team leave Gantt tab): this is "every request actionable by me right
// now", which also covers a skip-level manager's second sign-off on an
// earned-leave request from someone who isn't their direct report at all.
export async function listPendingApprovals(userId: string) {
  const result = await pool.query<LeaveRequestRow>(
    `${REQUEST_SELECT}
     WHERE lr.status = 'pending' AND (
       (lr.approver_id = $1 AND lr.approver_decision IS NULL)
       OR (lr.second_approver_id = $1 AND lr.approver_decision = 'approved' AND lr.second_approver_decision IS NULL)
       OR ($2::boolean AND lr.user_id <> $1 AND (
             (lr.approver_decision IS NULL AND ${approverCannotActSql("lr.approver_id")})
             OR (lr.approver_decision = 'approved' AND lr.second_approver_id IS NOT NULL AND lr.second_approver_decision IS NULL
                 AND ${approverCannotActSql("lr.second_approver_id")})
           ))
     )
     ORDER BY lr.created_at ASC`,
    [userId, await isAdminUser(userId)]
  );
  return result.rows.map(toPublicLeaveRequest);
}

// Oversight for Admins (leave_requests.view_all): every pending request in
// the company that is waiting on someone else - view only. What this user
// can decide themselves is already in listPendingApprovals.
export async function listPendingOversight(userId: string) {
  const [all, mine] = await Promise.all([
    pool.query<LeaveRequestRow>(`${REQUEST_SELECT} WHERE lr.status = 'pending' AND lr.user_id <> $1 ORDER BY lr.created_at ASC`, [userId]),
    listPendingApprovals(userId),
  ]);
  const actionable = new Set(mine.map((r) => r.id));
  return all.rows.filter((r) => !actionable.has(r.id)).map(toPublicLeaveRequest);
}

// For the Approvals inbox's "approved this week" stat - every decision this
// user personally made (as either tier) in the last 7 days, real timestamps
// only, no synthetic data.
// For the Approvals History tab - every decision this user personally made
// (as either tier), full history rather than listDecidedThisWeek's 7-day
// window (that one stays as-is, used only for the inbox's aggregate stat).
// Client decision: every past decision must be visible here, not just the
// most recent ones - so this is a generous safety ceiling against a runaway
// query, not a real business cap. 10,000 comfortably covers a lifetime of
// one manager's own approval history without ever silently dropping rows.
export async function listDecidedByUser(userId: string) {
  const result = await pool.query<LeaveRequestRow>(
    `${REQUEST_SELECT}
     WHERE (
       (lr.approver_id = $1 AND lr.approver_decision IS NOT NULL)
       OR (lr.second_approver_id = $1 AND lr.second_approver_decision IS NOT NULL)
     )
     ORDER BY COALESCE(lr.second_approver_decided_at, lr.approver_decided_at) DESC
     LIMIT 10000`,
    [userId]
  );
  return result.rows.map(toPublicLeaveRequest);
}

export async function listDecidedThisWeek(userId: string) {
  const result = await pool.query<{ created_at: string; decided_at: string }>(
    `SELECT created_at, approver_decided_at AS decided_at FROM leave_requests
       WHERE approver_id = $1 AND approver_decided_at IS NOT NULL AND approver_decided_at > now() - interval '7 days'
     UNION ALL
     SELECT created_at, second_approver_decided_at AS decided_at FROM leave_requests
       WHERE second_approver_id = $1 AND second_approver_decided_at IS NOT NULL AND second_approver_decided_at > now() - interval '7 days'`,
    [userId]
  );
  return result.rows;
}

async function getRequestById(id: string): Promise<LeaveRequestRow> {
  const result = await pool.query<LeaveRequestRow>(`${REQUEST_SELECT} WHERE lr.id = $1`, [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Leave request not found");
  }
  return result.rows[0];
}

// One person's requests take turns: the overlap and balance checks below
// read existing requests, so two submitted at the same moment could both
// pass and double-book the same days or overdraw the balance.
export function createLeaveRequest(userId: string, input: CreateLeaveRequestInput) {
  return withAdvisoryLock(`leave-request:${userId}`, () => createLeaveRequestNow(userId, input));
}

async function createLeaveRequestNow(userId: string, input: CreateLeaveRequestInput) {
  if (new Date(input.endDate) < new Date(input.startDate)) {
    throw new ApiError(422, "End date can't be before the start date");
  }
  if (input.kind === "half_day" && input.startDate !== input.endDate) {
    throw new ApiError(422, "A half day request can only cover a single date");
  }

  // No reporting manager: an Admin at the top of the org has nobody left to
  // approve their leave, so it's auto-approved; anyone else is left with no
  // named approver and lands in every Admin's queue (whichever Admin acts
  // first becomes the approver) instead of going through unchecked.
  const managerId = await getDirectManagerId(userId);
  // Self-approval only for an Admin with nobody else able to decide - when
  // other Admins exist, an Admin's own request goes to them like anyone's.
  const autoApprove = managerId === null && (await isAdminUser(userId)) && !(await anotherActiveAdminExists(userId));

  let secondApproverId: string | null = null;
  const daysCount = input.kind === "half_day" ? 0.5 : countWorkingDays(input.startDate, input.endDate);
  if (daysCount <= 0) {
    throw new ApiError(422, "That date range has no working days in it");
  }

  // The same days can't be requested twice - an overlapping pending or
  // approved request (any kind) would double-count them.
  // WFH isn't time off, so it never clashes with leave either way (someone
  // on approved WFH who falls sick must still be able to apply for sick
  // leave), and two half-days can share one date.
  const overlap =
    input.kind === "wfh"
      ? { rowCount: 0 }
      : await pool.query(
          `SELECT 1 FROM leave_requests
           WHERE user_id = $1 AND status IN ('pending', 'approved')
             AND start_date <= $3 AND end_date >= $2
             AND kind <> 'wfh'
             AND NOT (kind = 'half_day' AND $4 = 'half_day')
           LIMIT 1`,
          [userId, input.startDate, input.endDate, input.kind]
        );
  if ((overlap.rowCount ?? 0) > 0) {
    throw new ApiError(422, "You already have a leave request covering some of these dates");
  }

  // Cover must be someone the picker would offer: an active colleague in
  // the same role (the API is reachable directly, not just via the form).
  if (input.coverUserId) {
    const candidates = await listCoverCandidates(userId);
    if (!candidates.some((c) => c.id === input.coverUserId)) {
      throw new ApiError(422, "Cover must be an active colleague in the same role as you");
    }
  }

  // Days already asked for but not yet decided count against the balance
  // too - otherwise several pending requests could each fit the balance on
  // their own and all be approved, together far exceeding it.
  const pendingResult = await pool.query<{ days: string | null }>(
    "SELECT SUM(days_count) AS days FROM leave_requests WHERE user_id = $1 AND kind = $2 AND status = 'pending'",
    [userId, input.kind]
  );
  const pendingDays = Number(pendingResult.rows[0]?.days ?? 0);

  if (ENTITLEMENT_KINDS.includes(input.kind)) {
    const type = await getLeaveTypeByKey(input.kind as LeaveTypeKey);

    if (type.notice_days !== null) {
      // Calendar-day comparison, not a datetime one - anchoring the
      // deadline to `new Date()` directly would bake in the current
      // time-of-day, making the same request pass or fail notice purely
      // depending on what hour it happened to be submitted.
      const today = new Date();
      const noticeDeadline = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      noticeDeadline.setUTCDate(noticeDeadline.getUTCDate() + type.notice_days);
      if (new Date(`${input.startDate}T00:00:00Z`) < noticeDeadline) {
        throw new ApiError(422, `${type.label} needs at least ${type.notice_days} day${type.notice_days === 1 ? "" : "s"} notice`);
      }
    }
    if (type.max_consecutive_days !== null && daysCount > type.max_consecutive_days) {
      throw new ApiError(422, `${type.label} can't be taken for more than ${type.max_consecutive_days} days at a stretch`);
    }

    if (type.key === "comp_off") {
      const balances = await getBalances(userId);
      const compOff = balances.find((b) => b.key === "comp_off")!;
      const compOffLeft = compOff.available! - pendingDays;
      if (compOffLeft < daysCount) {
        throw new ApiError(422, `Not enough comp-off balance - ${Math.max(compOffLeft, 0)} day${compOffLeft === 1 ? "" : "s"} available after pending requests`);
      }
    } else {
      const balances = await getBalances(userId);
      const balance = balances.find((b) => b.key === type.key)!;
      const left = balance.available === null ? null : balance.available - pendingDays;
      if (left !== null && left < daysCount) {
        throw new ApiError(422, `Not enough ${type.label.toLowerCase()} balance - ${Math.max(left, 0)} day${left === 1 ? "" : "s"} available after pending requests`);
      }
    }

    if (type.requires_second_approver && managerId) {
      secondApproverId = await getDirectManagerId(managerId);
    }
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO leave_requests (user_id, kind, start_date, end_date, days_count, reason, cover_user_id, approver_id, second_approver_id, status, approver_decision, approver_decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      userId,
      input.kind,
      input.startDate,
      input.endDate,
      daysCount,
      input.reason,
      input.coverUserId ?? null,
      managerId,
      secondApproverId,
      autoApprove ? "approved" : "pending",
      autoApprove ? "approved" : null,
      autoApprove ? new Date() : null,
    ]
  );
  return toPublicLeaveRequest(await getRequestById(result.rows[0].id));
}

export async function decideLeaveRequest(requestId: string, deciderId: string, decision: "approved" | "rejected", ipAddress?: string | null) {
  const request = await getRequestById(requestId);
  if (request.status !== "pending") {
    throw new ApiError(409, "This request has already been decided");
  }

  // Admins pick up anything with no one able to act on it: no named
  // approver (no reporting manager), or a named approver who has since been
  // deactivated (e.g. left the company) - otherwise it's stuck forever.
  const adminStandIn = request.user_id !== deciderId && (await isAdminUser(deciderId));
  const isFirstApprover =
    request.approver_decision === null && (request.approver_id === deciderId || (adminStandIn && (await approverCannotAct(request.approver_id))));
  const isSecondApprover =
    !isFirstApprover &&
    request.approver_decision === "approved" &&
    request.second_approver_decision === null &&
    request.second_approver_id !== null &&
    (request.second_approver_id === deciderId || (adminStandIn && (await approverCannotAct(request.second_approver_id))));

  if (!isFirstApprover && !isSecondApprover) {
    throw new ApiError(403, "You're not the approver for this request");
  }

  // The WHERE guard (not just the pre-read above) is what actually closes
  // the race against a concurrent cancelLeaveRequest or a double-submitted
  // decision - whichever write reaches Postgres first locks the row, and
  // the loser's guarded UPDATE affects zero rows instead of silently
  // overwriting the winner's outcome.
  let decided;
  if (isFirstApprover) {
    const finalStatus = decision === "rejected" ? "rejected" : request.second_approver_id ? "pending" : "approved";
    decided = await pool.query(
      `UPDATE leave_requests SET approver_id = $4, approver_decision = $1, approver_decided_at = now(), status = $2, updated_at = now()
       WHERE id = $3 AND approver_decision IS NULL AND status = 'pending'`,
      [decision, finalStatus, requestId, deciderId]
    );
  } else {
    decided = await pool.query(
      `UPDATE leave_requests SET second_approver_id = $4, second_approver_decision = $1, second_approver_decided_at = now(), status = $2, updated_at = now()
       WHERE id = $3 AND second_approver_decision IS NULL AND status = 'pending'`,
      [decision, decision, requestId, deciderId]
    );
  }
  if (decided.rowCount === 0) {
    throw new ApiError(409, "This request has already been decided");
  }

  const label = `${request.user_name ?? "Unknown"} - ${request.kind.replace("_", " ")} leave`;
  await recordAuditEvent({
    entityType: "leave_request",
    entityId: requestId,
    entityLabel: label,
    action: "approval_decided",
    summary: `Approval ${decision} - ${label}`,
    oldValue: "Pending",
    newValue: decision === "approved" ? "Approved" : "Rejected",
    actorId: deciderId,
    ipAddress,
  });

  return toPublicLeaveRequest(await getRequestById(requestId));
}

export async function cancelLeaveRequest(requestId: string, userId: string) {
  const request = await getRequestById(requestId);
  if (request.user_id !== userId) {
    throw new ApiError(403, "You can only cancel your own leave request");
  }
  if (request.status !== "pending") {
    throw new ApiError(409, "Only a pending request can be cancelled");
  }
  const cancelled = await pool.query(
    `UPDATE leave_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  if (cancelled.rowCount === 0) {
    throw new ApiError(409, "Only a pending request can be cancelled");
  }
  return toPublicLeaveRequest(await getRequestById(requestId));
}

// Scoped to exactly what the Apply-for-leave form needs (own manager's
// name, and peers to offer as "cover") - deliberately not a call into
// GET /users, which is manager+ only and an agent applying for leave never
// holds that permission.
async function listCoverCandidates(userId: string): Promise<{ id: string; name: string }[]> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM users u
     WHERE u.role = (SELECT role FROM users WHERE id = $1) AND u.id <> $1 AND u.is_active = true
     ORDER BY u.name ASC`,
    [userId]
  );
  return result.rows;
}

export async function getLeaveContext(userId: string) {
  const managerId = await getDirectManagerId(userId);
  let managerName: string | null = null;

  if (managerId) {
    const managerResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [managerId]);
    managerName = managerResult.rows[0]?.name ?? null;
  }
  // Who can cover you: active colleagues in the same role (Call Center ->
  // Call Center, Field Sales -> Field Sales, Admin -> Admin) - someone who
  // can actually do your work while you're away.
  const peers = await listCoverCandidates(userId);

  const reportsResult = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE manager_id = $1 AND is_active = true ORDER BY name ASC",
    [userId]
  );

  return { managerId, managerName, peers, directReports: reportsResult.rows };
}

// Grantable by anyone the earner directly reports to - mirrors the same
// direct-manager relationship Leave approval itself uses, rather than a
// separate permission scope.
export async function grantCompOff(managerId: string, input: GrantCompOffInput) {
  const earnerManagerId = await getDirectManagerId(input.userId);
  if (earnerManagerId !== managerId) {
    throw new ApiError(403, "You can only grant comp-off to your own direct reports");
  }

  const type = await getLeaveTypeByKey("comp_off");
  const expiresAt = new Date(`${input.earnedDate}T00:00:00Z`);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + (type.expires_after_days ?? 60));

  await pool.query(
    `INSERT INTO comp_off_credits (user_id, earned_date, granted_by, reason, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.earnedDate, managerId, input.reason ?? null, expiresAt.toISOString().slice(0, 10)]
  );
  return getBalances(input.userId);
}
