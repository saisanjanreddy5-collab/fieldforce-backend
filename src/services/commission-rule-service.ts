import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface CommissionRuleRow {
  id: string;
  incentive_plan_id: string;
  name: string;
  description: string | null;
  rule_type: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCommissionRuleInput {
  incentivePlanId: string;
  name: string;
  description?: string;
  ruleType?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}

export interface UpdateCommissionRuleInput {
  name?: string;
  description?: string;
  ruleType?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}

function toPublicRule(row: CommissionRuleRow) {
  return {
    id: row.id,
    incentivePlanId: row.incentive_plan_id,
    name: row.name,
    description: row.description,
    ruleType: row.rule_type,
    config: row.config,
    isActive: row.is_active,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCommissionRules(incentivePlanId?: string) {
  const params: unknown[] = [];
  let where = "";
  if (incentivePlanId) {
    params.push(incentivePlanId);
    where = "WHERE incentive_plan_id = $1";
  }
  const result = await pool.query<CommissionRuleRow>(
    `SELECT * FROM commission_rules ${where} ORDER BY name ASC`,
    params
  );
  return result.rows.map(toPublicRule);
}

export async function getCommissionRuleById(id: string) {
  const result = await pool.query<CommissionRuleRow>("SELECT * FROM commission_rules WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Commission rule not found");
  }
  return toPublicRule(result.rows[0]);
}

async function assertPlanExists(incentivePlanId: string): Promise<void> {
  const plan = await pool.query<{ id: string }>("SELECT id FROM incentive_plans WHERE id = $1", [incentivePlanId]);
  if (plan.rows.length === 0) {
    throw new ApiError(422, "That incentive plan does not exist");
  }
}

export async function createCommissionRule(input: CreateCommissionRuleInput, requestingUserId: string) {
  await assertPlanExists(input.incentivePlanId);

  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM commission_rules WHERE incentive_plan_id = $1 AND name = $2",
    [input.incentivePlanId, input.name]
  );
  if (existing.rows.length > 0) {
    throw new ApiError(409, "This plan already has a commission rule with that name");
  }

  const result = await pool.query<CommissionRuleRow>(
    `INSERT INTO commission_rules (incentive_plan_id, name, description, rule_type, config, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, '{}'::jsonb), COALESCE($6, true), $7, $7)
     RETURNING *`,
    [
      input.incentivePlanId,
      input.name,
      input.description ?? null,
      input.ruleType ?? null,
      input.config ? JSON.stringify(input.config) : null,
      input.isActive ?? null,
      requestingUserId,
    ]
  );

  return toPublicRule(result.rows[0]);
}

export async function updateCommissionRule(id: string, updates: UpdateCommissionRuleInput, requestingUserId: string) {
  const current = await getCommissionRuleById(id);

  if (updates.name && updates.name !== current.name) {
    const nameTaken = await pool.query<{ id: string }>(
      "SELECT id FROM commission_rules WHERE incentive_plan_id = $1 AND name = $2 AND id <> $3",
      [current.incentivePlanId, updates.name, id]
    );
    if (nameTaken.rows.length > 0) {
      throw new ApiError(409, "This plan already has a commission rule with that name");
    }
  }

  const normalize = (value: string | undefined) => (value === "" ? null : value);
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    description: normalize(updates.description),
    rule_type: normalize(updates.ruleType),
    config: updates.config ? JSON.stringify(updates.config) : undefined,
    is_active: updates.isActive,
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
    return current;
  }

  params.push(requestingUserId);
  setClauses.push(`updated_by = $${params.length}`);
  setClauses.push("updated_at = now()");
  params.push(id);

  const result = await pool.query<CommissionRuleRow>(
    `UPDATE commission_rules SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicRule(result.rows[0]);
}

export async function deleteCommissionRule(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM commission_rules WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Commission rule not found");
  }
}
