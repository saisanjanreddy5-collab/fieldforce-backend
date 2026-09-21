import { pool } from "../config/db";

// Read-only Phase 3A foundation - nothing calls this yet. No route or
// service enforces its result; requireRole and the existing
// subtree/lead_shares record-visibility logic remain the only things that
// actually gate access until a later phase wires this in.
export async function getPermissionsForRole(role: string): Promise<string[]> {
  const result = await pool.query<{ permission: string }>(
    "SELECT permission FROM role_permissions WHERE role = $1 ORDER BY permission ASC",
    [role]
  );
  return result.rows.map((row) => row.permission);
}
