import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface IncentivePlanRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  effective_start_date: string;
  effective_end_date: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIncentivePlanInput {
  name: string;
  description?: string;
  isActive?: boolean;
  effectiveStartDate: string;
  effectiveEndDate?: string;
}

export interface UpdateIncentivePlanInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  effectiveStartDate?: string;
  effectiveEndDate?: string;
}

function toPublicPlan(row: IncentivePlanRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Configuration data, not a per-person record - visible to any Manager+ the
// same way sales_teams/levels/offices are, no subtree scoping needed.
export async function listIncentivePlans() {
  const result = await pool.query<IncentivePlanRow>("SELECT * FROM incentive_plans ORDER BY name ASC");
  return result.rows.map(toPublicPlan);
}

export async function getIncentivePlanById(id: string) {
  const result = await pool.query<IncentivePlanRow>("SELECT * FROM incentive_plans WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Incentive plan not found");
  }
  return toPublicPlan(result.rows[0]);
}

function assertValidDateRange(start: string | undefined, end: string | null | undefined): void {
  if (start && end && end < start) {
    throw new ApiError(422, "Effective end date cannot be before the effective start date");
  }
}

export async function createIncentivePlan(input: CreateIncentivePlanInput, requestingUserId: string) {
  assertValidDateRange(input.effectiveStartDate, input.effectiveEndDate);

  const existing = await pool.query<{ id: string }>("SELECT id FROM incentive_plans WHERE name = $1", [input.name]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, "An incentive plan with this name already exists");
  }

  const result = await pool.query<IncentivePlanRow>(
    `INSERT INTO incentive_plans (name, description, is_active, effective_start_date, effective_end_date, created_by, updated_by)
     VALUES ($1, $2, COALESCE($3, true), $4, $5, $6, $6)
     RETURNING *`,
    [
      input.name,
      input.description ?? null,
      input.isActive ?? null,
      input.effectiveStartDate,
      input.effectiveEndDate ?? null,
      requestingUserId,
    ]
  );

  return toPublicPlan(result.rows[0]);
}

export async function updateIncentivePlan(id: string, updates: UpdateIncentivePlanInput, requestingUserId: string) {
  const current = await getIncentivePlanById(id);

  const nextStart = updates.effectiveStartDate ?? current.effectiveStartDate;
  const nextEnd = updates.effectiveEndDate !== undefined ? updates.effectiveEndDate : current.effectiveEndDate;
  assertValidDateRange(nextStart, nextEnd);

  if (updates.name && updates.name !== current.name) {
    const nameTaken = await pool.query<{ id: string }>(
      "SELECT id FROM incentive_plans WHERE name = $1 AND id <> $2",
      [updates.name, id]
    );
    if (nameTaken.rows.length > 0) {
      throw new ApiError(409, "An incentive plan with this name already exists");
    }
  }

  const normalize = (value: string | undefined) => (value === "" ? null : value);
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    description: normalize(updates.description),
    is_active: updates.isActive,
    effective_start_date: updates.effectiveStartDate,
    effective_end_date: updates.effectiveEndDate !== undefined ? normalize(updates.effectiveEndDate) : undefined,
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

  const result = await pool.query<IncentivePlanRow>(
    `UPDATE incentive_plans SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicPlan(result.rows[0]);
}

export async function deleteIncentivePlan(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM incentive_plans WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Incentive plan not found");
  }
}
