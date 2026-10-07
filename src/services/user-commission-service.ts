import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { Role, ROLES } from "../utils/roles";

export const COMMISSION_BASES = ["collected_revenue", "invoiced_revenue", "gross_margin", "units_sold"] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const PAYOUT_CYCLES = ["monthly", "quarterly", "half_yearly", "annual"] as const;
export type PayoutCycle = (typeof PAYOUT_CYCLES)[number];

interface UserCommissionRow {
  id: string;
  user_id: string;
  basis: CommissionBasis;
  rate: string | null;
  applies_to: string | null;
  payout_cycle: PayoutCycle;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserCommissionInput {
  userId: string;
  basis: CommissionBasis;
  rate?: string;
  appliesTo?: string;
  payoutCycle: PayoutCycle;
}

function toPublicCommission(row: UserCommissionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    basis: row.basis,
    rate: row.rate,
    appliesTo: row.applies_to,
    payoutCycle: row.payout_cycle,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

export interface ListUserCommissionsFilters {
  userId?: string;
  page: number;
  limit: number;
}

// Configuration only, same as user_incentive_plans (its sibling in the
// Create/Edit user wizard's own "Commissions" section) - a per-employee
// arrangement, not the shared commission_rules catalog. No payout engine
// reads this.
export async function listUserCommissions(requestingUserId: string, requestingRole: Role, filters: ListUserCommissionsFilters) {
  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  if (requestingRole === ROLES.ADMIN) {
    const params: unknown[] = [];
    let where = "";
    if (filters.userId) {
      params.push(filters.userId);
      where = "WHERE user_id = $1";
    }

    const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM user_commissions ${where}`, params);

    const listParams = [...params, limit, offset];
    const result = await pool.query<UserCommissionRow>(
      `SELECT * FROM user_commissions ${where} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    return { userCommissions: result.rows.map(toPublicCommission), total: Number(countResult.rows[0].count) };
  }

  const params: unknown[] = [requestingUserId];
  let extraFilter = "";
  if (filters.userId) {
    params.push(filters.userId);
    extraFilter = `AND user_id = $${params.length}`;
  }

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE}
     SELECT COUNT(*) FROM user_commissions
     WHERE user_id IN (SELECT id FROM subtree) ${extraFilter}`,
    params
  );

  const listParams = [...params, limit, offset];
  const result = await pool.query<UserCommissionRow>(
    `${SUBTREE_CTE}
     SELECT * FROM user_commissions
     WHERE user_id IN (SELECT id FROM subtree) ${extraFilter}
     ORDER BY created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  return { userCommissions: result.rows.map(toPublicCommission), total: Number(countResult.rows[0].count) };
}

export async function createUserCommission(input: CreateUserCommissionInput, requestingUserId: string) {
  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE id = $1", [input.userId]);
  if (user.rows.length === 0) {
    throw new ApiError(422, "That person does not exist");
  }

  const result = await pool.query<UserCommissionRow>(
    `INSERT INTO user_commissions (user_id, basis, rate, applies_to, payout_cycle, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.userId, input.basis, input.rate ?? null, input.appliesTo ?? null, input.payoutCycle, requestingUserId]
  );

  return toPublicCommission(result.rows[0]);
}

export async function deleteUserCommission(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM user_commissions WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Commission arrangement not found");
  }
}
