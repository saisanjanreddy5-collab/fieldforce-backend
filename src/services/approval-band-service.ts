import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

export const REQUEST_TYPES = ["discount", "customer_creation", "credit_limit", "expense_claim"] as const;
export type ApprovalRequestType = (typeof REQUEST_TYPES)[number];

interface ApprovalBandRow {
  id: string;
  request_type: ApprovalRequestType;
  band_name: string;
  range_from: string;
  range_to: string | null;
  approver_level_id: string | null;
  countersigned_by_level_id: string | null;
  sla_hours: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateApprovalBandInput {
  requestType: ApprovalRequestType;
  bandName: string;
  rangeFrom?: number;
  rangeTo?: number;
  approverLevelId?: string;
  countersignedByLevelId?: string;
  slaHours?: number;
  sortOrder?: number;
}

export interface UpdateApprovalBandInput {
  bandName?: string;
  rangeFrom?: number;
  rangeTo?: number | null;
  approverLevelId?: string | null;
  countersignedByLevelId?: string | null;
  slaHours?: number | null;
  sortOrder?: number;
}

function toPublicBand(row: ApprovalBandRow) {
  return {
    id: row.id,
    requestType: row.request_type,
    bandName: row.band_name,
    rangeFrom: Number(row.range_from),
    rangeTo: row.range_to === null ? null : Number(row.range_to),
    approverLevelId: row.approver_level_id,
    countersignedByLevelId: row.countersigned_by_level_id,
    slaHours: row.sla_hours,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Configuration only - nothing reads this table to actually approve or
// escalate anything, because FieldForce has no request/workflow system
// anywhere else to enforce it against (see Phase 8 note in models/model.ts).
export async function listApprovalBands() {
  const result = await pool.query<ApprovalBandRow>(
    "SELECT * FROM approval_bands ORDER BY request_type ASC, sort_order ASC, range_from ASC"
  );
  return result.rows.map(toPublicBand);
}

async function getBandById(id: string) {
  const result = await pool.query<ApprovalBandRow>("SELECT * FROM approval_bands WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Approval band not found");
  }
  return toPublicBand(result.rows[0]);
}

async function assertLevelExists(levelId: string | undefined | null, label: string): Promise<void> {
  if (!levelId) return;
  const level = await pool.query<{ id: string }>("SELECT id FROM levels WHERE id = $1", [levelId]);
  if (level.rows.length === 0) {
    throw new ApiError(422, `That ${label} does not exist`);
  }
}

export async function createApprovalBand(input: CreateApprovalBandInput) {
  await assertLevelExists(input.approverLevelId, "approver");
  await assertLevelExists(input.countersignedByLevelId, "countersigner");

  const result = await pool.query<{ id: string }>(
    `INSERT INTO approval_bands (request_type, band_name, range_from, range_to, approver_level_id, countersigned_by_level_id, sla_hours, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.requestType,
      input.bandName,
      input.rangeFrom ?? 0,
      input.rangeTo ?? null,
      input.approverLevelId ?? null,
      input.countersignedByLevelId ?? null,
      input.slaHours ?? null,
      input.sortOrder ?? 0,
    ]
  );
  return getBandById(result.rows[0].id);
}

export async function updateApprovalBand(id: string, updates: UpdateApprovalBandInput) {
  const current = await getBandById(id);
  if (updates.approverLevelId) {
    await assertLevelExists(updates.approverLevelId, "approver");
  }
  if (updates.countersignedByLevelId) {
    await assertLevelExists(updates.countersignedByLevelId, "countersigner");
  }

  const fieldMap: Record<string, unknown> = {
    band_name: updates.bandName,
    range_from: updates.rangeFrom,
    range_to: updates.rangeTo,
    approver_level_id: updates.approverLevelId,
    countersigned_by_level_id: updates.countersignedByLevelId,
    sla_hours: updates.slaHours,
    sort_order: updates.sortOrder,
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

  setClauses.push("updated_at = now()");
  params.push(id);
  await pool.query(`UPDATE approval_bands SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);

  return getBandById(id);
}

export async function deleteApprovalBand(id: string): Promise<void> {
  const result = await pool.query("DELETE FROM approval_bands WHERE id = $1", [id]);
  if (result.rowCount === 0) {
    throw new ApiError(404, "Approval band not found");
  }
}
