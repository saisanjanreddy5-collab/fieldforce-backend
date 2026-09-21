import { pool } from "../config/db";
import { ROLES } from "../utils/roles";

interface RolePermissionRow {
  role: string;
  permission: string;
}

// The full permission catalog is derived from the table itself (admin holds
// every entry, by Phase 3A's own design) rather than duplicated as a second
// hardcoded list somewhere else - one source of truth, no risk of drift.
export async function listRolePermissionMatrix() {
  const result = await pool.query<RolePermissionRow>("SELECT role, permission FROM role_permissions ORDER BY permission ASC");
  const catalog = Array.from(new Set(result.rows.map((r) => r.permission))).sort();
  const grants: Record<string, string[]> = { [ROLES.ADMIN]: [], [ROLES.MANAGER]: [], [ROLES.AGENT]: [] };
  for (const row of result.rows) {
    if (grants[row.role]) grants[row.role].push(row.permission);
  }
  return { catalog, roles: Object.values(ROLES), grants };
}

// Live: getPermissionsForRole reads this same table with no caching, so a
// grant/revoke here takes effect on the very next request for
// leads/opportunities/activities (requirePermission-enforced). For the other
// 9 modules, still requireRole-gated per the Phase 3 closeout, this only
// changes what this screen displays - the route's real gate is untouched.
export async function setRolePermission(role: string, permission: string, granted: boolean): Promise<void> {
  if (granted) {
    await pool.query(
      "INSERT INTO role_permissions (role, permission) VALUES ($1, $2) ON CONFLICT (role, permission) DO NOTHING",
      [role, permission]
    );
  } else {
    await pool.query("DELETE FROM role_permissions WHERE role = $1 AND permission = $2", [role, permission]);
  }
}
