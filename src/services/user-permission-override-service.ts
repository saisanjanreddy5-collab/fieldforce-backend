import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface OverrideRow {
  id: string;
  user_id: string;
  permission: string;
  grant_type: "grant" | "revoke";
  reason: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  cleared_by: string | null;
  cleared_by_name: string | null;
  cleared_at: string | null;
}

function toPublicOverride(row: OverrideRow) {
  return {
    id: row.id,
    userId: row.user_id,
    permission: row.permission,
    grantType: row.grant_type,
    reason: row.reason,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    clearedBy: row.cleared_by,
    clearedByName: row.cleared_by_name,
    clearedAt: row.cleared_at,
  };
}

const NAME_JOIN = `
  LEFT JOIN users creator ON creator.id = o.created_by
  LEFT JOIN users clearer ON clearer.id = o.cleared_by
`;

// Full history for this user - active and cleared overrides both, oldest
// first, so the "Override history" list reads chronologically.
export async function listOverridesForUser(userId: string) {
  const result = await pool.query<OverrideRow>(
    `SELECT o.*, creator.name AS created_by_name, clearer.name AS cleared_by_name
     FROM user_permission_overrides o
     ${NAME_JOIN}
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC`,
    [userId]
  );
  return result.rows.map(toPublicOverride);
}

export async function createOverride(
  userId: string,
  permission: string,
  grantType: "grant" | "revoke",
  reason: string | undefined,
  expiresAt: string | undefined,
  createdBy: string
) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO user_permission_overrides (user_id, permission, grant_type, reason, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, permission, grantType, reason ?? null, expiresAt ?? null, createdBy]
  );
  const result2 = await pool.query<OverrideRow>(
    `SELECT o.*, creator.name AS created_by_name, clearer.name AS cleared_by_name
     FROM user_permission_overrides o ${NAME_JOIN} WHERE o.id = $1`,
    [result.rows[0].id]
  );
  return toPublicOverride(result2.rows[0]);
}

export async function clearOverride(id: string, clearedBy: string) {
  const result = await pool.query<{ id: string }>(
    "UPDATE user_permission_overrides SET cleared_by = $1, cleared_at = now() WHERE id = $2 AND cleared_at IS NULL RETURNING id",
    [clearedBy, id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Active override not found");
  }
}

// Clears every currently-active override for this person in one action,
// matching the reference mockup's "Clear overrides" button.
export async function clearAllOverridesForUser(userId: string, clearedBy: string): Promise<number> {
  const result = await pool.query(
    "UPDATE user_permission_overrides SET cleared_by = $1, cleared_at = now() WHERE user_id = $2 AND cleared_at IS NULL",
    [clearedBy, userId]
  );
  return result.rowCount ?? 0;
}
