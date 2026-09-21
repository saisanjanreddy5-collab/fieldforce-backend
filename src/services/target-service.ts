import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { Role, ROLES } from "../utils/roles";

interface TargetRow {
  id: string;
  user_id: string;
  period_type: string;
  period_start: string;
  period_end: string;
  target_amount: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  achieved_amount: string;
}

export interface CreateTargetInput {
  userId: string;
  periodType: "monthly" | "quarterly" | "annual";
  periodAnchor: string;
  targetAmount: number;
}

export interface UpdateTargetInput {
  periodType?: "monthly" | "quarterly" | "annual";
  periodAnchor?: string;
  targetAmount?: number;
}

// The business timezone for deciding which calendar period a Won
// opportunity's won_at falls into - not derived from anything else in the
// app (nothing set a convention before this), chosen because this is an
// India-based business. See config/db.ts for the separate DATE-column fix;
// this is unrelated (won_at is a real moment in time, correctly TIMESTAMPTZ).
const BUSINESS_TIMEZONE = "Asia/Kolkata";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Computes the exact calendar-date boundaries for a period from a type and
// an anchor date (any date inside the desired month/quarter/year) - the
// server is authoritative for this math, the client only has to say which
// month/quarter/year was picked.
function computePeriodBoundaries(periodType: string, anchor: string): { periodStart: string; periodEnd: string } {
  const [yearStr, monthStr] = anchor.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (periodType === "annual") {
    return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
  }

  if (periodType === "quarterly") {
    const quarter = Math.ceil(month / 3);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(year, endMonth, 0).getDate();
    return {
      periodStart: `${year}-${pad(startMonth)}-01`,
      periodEnd: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
    };
  }

  const lastDay = new Date(year, month, 0).getDate();
  return {
    periodStart: `${year}-${pad(month)}-01`,
    periodEnd: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

function toPublicTarget(row: TargetRow) {
  const targetAmount = Number(row.target_amount);
  const achievedAmount = Number(row.achieved_amount ?? 0);
  const remainingAmount = Math.max(targetAmount - achievedAmount, 0);
  const achievementPercent = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 1000) / 10 : 0;

  return {
    id: row.id,
    userId: row.user_id,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    targetAmount,
    achievedAmount,
    remainingAmount,
    achievementPercent,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Same visibility shape as listUsers: an Admin sees everyone's targets, a
// Manager only their own reporting subtree - so this can't be used to see
// another branch's numbers by passing a different userId.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// One LATERAL join computes achieved-in-period entirely in Postgres - no
// opportunities are ever loaded into JS just to sum them.
const ACHIEVED_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(o.value), 0) AS total
    FROM opportunities o
    JOIN leads l ON l.id = o.lead_id
    WHERE l.owner_id = t.user_id
      AND o.stage = 'won'
      AND o.is_deleted = false
      AND (o.won_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date BETWEEN t.period_start AND t.period_end
  ) achieved ON true
`;

export async function listTargets(requestingUserId: string, requestingRole: Role, userId?: string) {
  if (requestingRole === ROLES.ADMIN) {
    const params: unknown[] = [];
    let where = "";
    if (userId) {
      params.push(userId);
      where = "WHERE t.user_id = $1";
    }
    const result = await pool.query<TargetRow>(
      `SELECT t.*, achieved.total AS achieved_amount
       FROM targets t
       ${ACHIEVED_JOIN}
       ${where}
       ORDER BY t.period_start DESC`,
      params
    );
    return result.rows.map(toPublicTarget);
  }

  const params: unknown[] = [requestingUserId];
  let extraFilter = "";
  if (userId) {
    params.push(userId);
    extraFilter = `AND t.user_id = $${params.length}`;
  }

  const result = await pool.query<TargetRow>(
    `${SUBTREE_CTE}
     SELECT t.*, achieved.total AS achieved_amount
     FROM targets t
     ${ACHIEVED_JOIN}
     WHERE t.user_id IN (SELECT id FROM subtree) ${extraFilter}
     ORDER BY t.period_start DESC`,
    params
  );
  return result.rows.map(toPublicTarget);
}

async function isTargetVisibleToUser(targetUserId: string, requestingUserId: string, requestingRole: Role): Promise<boolean> {
  if (requestingRole === ROLES.ADMIN) return true;

  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM subtree WHERE id = $2`,
    [requestingUserId, targetUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getTargetById(id: string, requestingUserId: string, requestingRole: Role) {
  const result = await pool.query<TargetRow>(
    `SELECT t.*, achieved.total AS achieved_amount
     FROM targets t
     ${ACHIEVED_JOIN}
     WHERE t.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "Target not found");
  }

  const visible = await isTargetVisibleToUser(row.user_id, requestingUserId, requestingRole);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this target");
  }

  return toPublicTarget(row);
}

export async function createTarget(input: CreateTargetInput, requestingUserId: string) {
  const { periodStart, periodEnd } = computePeriodBoundaries(input.periodType, input.periodAnchor);

  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM targets WHERE user_id = $1 AND period_type = $2 AND period_start = $3",
    [input.userId, input.periodType, periodStart]
  );
  if (existing.rows.length > 0) {
    throw new ApiError(409, "This person already has a target for that period");
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO targets (user_id, period_type, period_start, period_end, target_amount, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id`,
    [input.userId, input.periodType, periodStart, periodEnd, input.targetAmount, requestingUserId]
  );

  return getTargetById(result.rows[0].id, requestingUserId, ROLES.ADMIN);
}

export async function updateTarget(id: string, updates: UpdateTargetInput, requestingUserId: string) {
  const current = await pool.query<TargetRow>("SELECT * FROM targets WHERE id = $1", [id]);
  if (current.rows.length === 0) {
    throw new ApiError(404, "Target not found");
  }
  const row = current.rows[0];

  const periodType = updates.periodType ?? row.period_type;
  const periodAnchor = updates.periodAnchor ?? row.period_start;
  const { periodStart, periodEnd } =
    updates.periodType || updates.periodAnchor
      ? computePeriodBoundaries(periodType, periodAnchor)
      : { periodStart: row.period_start, periodEnd: row.period_end };

  if (updates.periodType || updates.periodAnchor) {
    const conflict = await pool.query<{ id: string }>(
      "SELECT id FROM targets WHERE user_id = $1 AND period_type = $2 AND period_start = $3 AND id <> $4",
      [row.user_id, periodType, periodStart, id]
    );
    if (conflict.rows.length > 0) {
      throw new ApiError(409, "This person already has a target for that period");
    }
  }

  await pool.query(
    `UPDATE targets
     SET period_type = $1, period_start = $2, period_end = $3,
         target_amount = COALESCE($4, target_amount),
         updated_by = $5, updated_at = now()
     WHERE id = $6`,
    [periodType, periodStart, periodEnd, updates.targetAmount ?? null, requestingUserId, id]
  );

  return getTargetById(id, requestingUserId, ROLES.ADMIN);
}

export async function deleteTarget(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM targets WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Target not found");
  }
}
