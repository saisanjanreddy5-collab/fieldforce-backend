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

// Configuration only, same as user_incentive_plans (its sibling in the
// Create/Edit user wizard's own "Commissions" section) - a per-employee
// arrangement, not the shared commission_rules catalog. No payout engine
// reads this.
export async function listUserCommissions(requestingUserId: string, requestingRole: Role, userId?: string) {
  if (requestingRole === ROLES.ADMIN) {
    const params: unknown[] = [];
    let where = "";
    if (userId) {
      params.push(userId);
      where = "WHERE user_id = $1";
    }
    const result = await pool.query<UserCommissionRow>(`SELECT * FROM user_commissions ${where} ORDER BY created_at DESC`, params);
    return result.rows.map(toPublicCommission);
  }

  const params: unknown[] = [requestingUserId];
  let extraFilter = "";
  if (userId) {
    params.push(userId);
    extraFilter = `AND user_id = $${params.length}`;
  }
  const result = await pool.query<UserCommissionRow>(
    `${SUBTREE_CTE}
     SELECT * FROM user_commissions
     WHERE user_id IN (SELECT id FROM subtree) ${extraFilter}
     ORDER BY created_at DESC`,
    params
  );
  return result.rows.map(toPublicCommission);
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
