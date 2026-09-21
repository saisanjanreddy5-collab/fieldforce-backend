import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface DelegationRow {
  id: string;
  user_id: string;
  delegate_id: string;
  start_date: string;
  end_date: string;
  created_by: string | null;
  created_at: string;
}

function toPublicDelegation(row: DelegationRow) {
  return {
    id: row.id,
    userId: row.user_id,
    delegateId: row.delegate_id,
    startDate: row.start_date,
    endDate: row.end_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// Foundation only (see model.ts) - FieldForce has no live approval-request
// flow for a delegate to actually receive, so this just records who covers
// for whom and when.
export async function listDelegations() {
  const result = await pool.query<DelegationRow>("SELECT * FROM delegations ORDER BY start_date DESC");
  return result.rows.map(toPublicDelegation);
}

export interface CreateDelegationInput {
  userId: string;
  delegateId: string;
  startDate: string;
  endDate: string;
}

export async function createDelegation(input: CreateDelegationInput, requestingUserId: string) {
  if (input.userId === input.delegateId) {
    throw new ApiError(422, "A person cannot delegate to themselves");
  }
  const result = await pool.query<DelegationRow>(
    `INSERT INTO delegations (user_id, delegate_id, start_date, end_date, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.userId, input.delegateId, input.startDate, input.endDate, requestingUserId]
  );
  return toPublicDelegation(result.rows[0]);
}

export async function deleteDelegation(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM delegations WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Delegation not found");
  }
}
