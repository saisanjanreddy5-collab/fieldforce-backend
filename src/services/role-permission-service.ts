import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { ROLES } from "../utils/roles";

interface RolePermissionRow {
  role: string;
  permission: string;
}

// Exactly what each role was seeded with across every phase of the Phase 3A
// catalog and its later retrofits (see model.ts's INSERT INTO
// role_permissions blocks) - the literal, deterministic "factory settings"
// that "Reset role to default" restores, discarding whatever an admin has
// toggled since.
const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  [ROLES.ADMIN]: [
    "users.view", "users.create", "users.update",
    "leads.view", "leads.create", "leads.update", "leads.delete", "leads.share",
    "opportunities.view", "opportunities.create", "opportunities.update", "opportunities.delete",
    "activities.view", "activities.create", "activities.update", "activities.delete",
    "attendance.view_own", "attendance.view_team",
    "dashboard.view",
    "offices.view", "offices.create", "offices.update",
    "levels.view", "levels.create",
    "sales_teams.view", "sales_teams.create",
    "targets.view", "targets.create", "targets.update", "targets.delete",
    "incentive_plans.view", "incentive_plans.create", "incentive_plans.update", "incentive_plans.delete",
    "commission_rules.view", "commission_rules.create", "commission_rules.update", "commission_rules.delete",
    "role_permissions.view", "role_permissions.update",
    "user_permission_overrides.view", "user_permission_overrides.create", "user_permission_overrides.delete",
    "manager_change_log.view",
    "approval_bands.view", "approval_bands.create", "approval_bands.update", "approval_bands.delete",
    "territory_transfers.view", "territory_transfers.create",
    "delegations.view", "delegations.create", "delegations.delete",
    "fofo_onboarding.view", "fofo_onboarding.manage", "fofo_onboarding.upload_document",
    "reports.view", "reports.save_view",
  ],
  [ROLES.MANAGER]: [
    "users.view",
    "leads.view", "leads.create", "leads.update", "leads.delete", "leads.share",
    "opportunities.view", "opportunities.create", "opportunities.update", "opportunities.delete",
    "activities.view", "activities.create", "activities.update", "activities.delete",
    "attendance.view_own", "attendance.view_team",
    "dashboard.view",
    "offices.view", "offices.create", "offices.update",
    "levels.view", "levels.create",
    "sales_teams.view", "sales_teams.create",
    "targets.view",
    "incentive_plans.view",
    "commission_rules.view",
    "role_permissions.view",
    "manager_change_log.view",
    "approval_bands.view",
    "territory_transfers.view", "territory_transfers.create",
    "delegations.view", "delegations.create", "delegations.delete",
    "fofo_onboarding.view", "fofo_onboarding.manage", "fofo_onboarding.upload_document",
    "reports.view", "reports.save_view",
  ],
  [ROLES.AGENT]: [
    "leads.view", "leads.create", "leads.update", "leads.delete", "leads.share",
    "opportunities.view", "opportunities.create", "opportunities.update", "opportunities.delete",
    "activities.view", "activities.create", "activities.update", "activities.delete",
    "attendance.view_own", "attendance.view_team",
    "dashboard.view",
    "offices.view",
    "levels.view",
    "sales_teams.view",
    "fofo_onboarding.view", "fofo_onboarding.upload_document",
  ],
};

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

// Discards every grant/revoke made from this screen and restores exactly
// what the role was seeded with - a full DELETE + re-INSERT rather than a
// diff, so it's unambiguous and always lands on the same result no matter
// how far the live table has drifted.
export async function resetRoleToDefault(role: string): Promise<void> {
  const defaults = DEFAULT_ROLE_PERMISSIONS[role];
  if (!defaults) {
    throw new ApiError(422, "Unknown role");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM role_permissions WHERE role = $1", [role]);
    for (const permission of defaults) {
      await client.query("INSERT INTO role_permissions (role, permission) VALUES ($1, $2)", [role, permission]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
