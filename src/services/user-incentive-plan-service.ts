import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { Role, ROLES } from "../utils/roles";

interface UserIncentivePlanRow {
  id: string;
  user_id: string;
  incentive_plan_id: string;
  effective_start_date: string;
  effective_end_date: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserIncentivePlanInput {
  userId: string;
  incentivePlanId: string;
  effectiveStartDate: string;
  effectiveEndDate?: string;
}

function toPublicAssignment(row: UserIncentivePlanRow) {
  return {
    id: row.id,
    userId: row.user_id,
    incentivePlanId: row.incentive_plan_id,
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Foundation only (see Phase 1C scope note) - no UI calls this yet. Visible
// the same way targets are (per-person record -> subtree-scoped), not the
// same way plans/rules are (org-wide config).
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

export async function listUserIncentivePlans(requestingUserId: string, requestingRole: Role, userId?: string) {
  if (requestingRole === ROLES.ADMIN) {
    const params: unknown[] = [];
    let where = "";
    if (userId) {
      params.push(userId);
      where = "WHERE user_id = $1";
    }
    const result = await pool.query<UserIncentivePlanRow>(
      `SELECT * FROM user_incentive_plans ${where} ORDER BY effective_start_date DESC`,
      params
    );
    return result.rows.map(toPublicAssignment);
  }

  const params: unknown[] = [requestingUserId];
  let extraFilter = "";
  if (userId) {
    params.push(userId);
    extraFilter = `AND user_id = $${params.length}`;
  }
  const result = await pool.query<UserIncentivePlanRow>(
    `${SUBTREE_CTE}
     SELECT * FROM user_incentive_plans
     WHERE user_id IN (SELECT id FROM subtree) ${extraFilter}
     ORDER BY effective_start_date DESC`,
    params
  );
  return result.rows.map(toPublicAssignment);
}

export async function createUserIncentivePlan(input: CreateUserIncentivePlanInput, requestingUserId: string) {
  const plan = await pool.query<{ id: string }>("SELECT id FROM incentive_plans WHERE id = $1", [input.incentivePlanId]);
  if (plan.rows.length === 0) {
    throw new ApiError(422, "That incentive plan does not exist");
  }

  const result = await pool.query<UserIncentivePlanRow>(
    `INSERT INTO user_incentive_plans (user_id, incentive_plan_id, effective_start_date, effective_end_date, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING *`,
    [input.userId, input.incentivePlanId, input.effectiveStartDate, input.effectiveEndDate ?? null, requestingUserId]
  );

  return toPublicAssignment(result.rows[0]);
}

export async function deleteUserIncentivePlan(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM user_incentive_plans WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Assignment not found");
  }
}
