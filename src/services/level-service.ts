import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { Role, ROLES } from "../utils/roles";

export const RECORD_SCOPES = [
  "own_only",
  "own_and_below",
  "own_below_peers_readonly",
  "whole_region",
  "everything",
] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];

interface LevelRow {
  id: string;
  name: string;
  sort_order: number;
  description: string | null;
  headcount_limit: number | null;
  approval_ceiling: string | null;
  security_tier: Role;
  is_cross_cutting: boolean;
  record_scope: RecordScope;
  sees_label_override: string | null;
  approval_label_override: string | null;
  can_edit_label: string | null;
  created_at: string;
  current_headcount: string;
}

export interface CreateLevelInput {
  name: string;
  sortOrder?: number;
  description?: string;
  headcountLimit?: number;
  approvalCeiling?: number;
  securityTier?: Role;
  isCrossCutting?: boolean;
  recordScope?: RecordScope;
  seesLabelOverride?: string;
  approvalLabelOverride?: string;
  canEditLabel?: string;
}

export interface UpdateLevelInput {
  name?: string;
  sortOrder?: number;
  description?: string;
  headcountLimit?: number | null;
  approvalCeiling?: number | null;
  securityTier?: Role;
  isCrossCutting?: boolean;
  recordScope?: RecordScope;
  seesLabelOverride?: string | null;
  approvalLabelOverride?: string | null;
  canEditLabel?: string | null;
}

function toPublicLevel(row: LevelRow) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    description: row.description,
    headcountLimit: row.headcount_limit,
    approvalCeiling: row.approval_ceiling === null ? null : Number(row.approval_ceiling),
    securityTier: row.security_tier,
    isCrossCutting: row.is_cross_cutting,
    recordScope: row.record_scope,
    seesLabelOverride: row.sees_label_override,
    approvalLabelOverride: row.approval_label_override,
    canEditLabel: row.can_edit_label,
    currentHeadcount: Number(row.current_headcount ?? 0),
    createdAt: row.created_at,
  };
}

// Current headcount is computed from users.level_id, not stored - same
// "single source of truth via LATERAL join" pattern as offices.employeeCount.
const HEADCOUNT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count FROM users u WHERE u.level_id = l.id AND u.is_active = true
  ) hc ON true
`;

// The real security tier a level's people get at login - so picking a
// Level in the People wizard is not just a display label, it actually
// determines the account's requireRole/requirePermission access. See
// auth-service.ts's registerUser and user-service.ts's updateUser.
export async function getLevelSecurityTier(levelId: string): Promise<Role> {
  const result = await pool.query<{ security_tier: Role }>("SELECT security_tier FROM levels WHERE id = $1", [levelId]);
  if (result.rows.length === 0) {
    throw new ApiError(422, "That level does not exist");
  }
  return result.rows[0].security_tier;
}

export async function listLevels() {
  const result = await pool.query<LevelRow>(
    `SELECT l.*, hc.count AS current_headcount FROM levels l ${HEADCOUNT_JOIN} ORDER BY l.sort_order ASC, l.name ASC`
  );
  return result.rows.map(toPublicLevel);
}

async function getLevelById(id: string) {
  const result = await pool.query<LevelRow>(
    `SELECT l.*, hc.count AS current_headcount FROM levels l ${HEADCOUNT_JOIN} WHERE l.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Level not found");
  }
  return toPublicLevel(result.rows[0]);
}

export async function createLevel(input: CreateLevelInput) {
  const existing = await pool.query<{ id: string }>("SELECT id FROM levels WHERE name = $1", [input.name]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, "A level with this name already exists");
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO levels (name, sort_order, description, headcount_limit, approval_ceiling, security_tier, is_cross_cutting, record_scope, sees_label_override, approval_label_override, can_edit_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.name,
      input.sortOrder ?? 0,
      input.description ?? null,
      input.headcountLimit ?? null,
      input.approvalCeiling ?? null,
      input.securityTier ?? ROLES.MANAGER,
      input.isCrossCutting ?? false,
      input.recordScope ?? "own_and_below",
      input.seesLabelOverride ?? null,
      input.approvalLabelOverride ?? null,
      input.canEditLabel ?? null,
    ]
  );
  return getLevelById(result.rows[0].id);
}

export async function updateLevel(id: string, updates: UpdateLevelInput) {
  const current = await getLevelById(id);

  if (updates.name && updates.name !== current.name) {
    const nameTaken = await pool.query<{ id: string }>("SELECT id FROM levels WHERE name = $1 AND id <> $2", [
      updates.name,
      id,
    ]);
    if (nameTaken.rows.length > 0) {
      throw new ApiError(409, "A level with this name already exists");
    }
  }

  const normalize = (value: string | null | undefined) => (value === "" ? null : value);
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    sort_order: updates.sortOrder,
    description: normalize(updates.description),
    headcount_limit: updates.headcountLimit,
    approval_ceiling: updates.approvalCeiling,
    security_tier: updates.securityTier,
    is_cross_cutting: updates.isCrossCutting,
    record_scope: updates.recordScope,
    sees_label_override: normalize(updates.seesLabelOverride),
    approval_label_override: normalize(updates.approvalLabelOverride),
    can_edit_label: normalize(updates.canEditLabel),
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

  params.push(id);
  await pool.query(`UPDATE levels SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);

  return getLevelById(id);
}
