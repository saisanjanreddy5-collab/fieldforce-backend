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
    "levels.view", "levels.create", "levels.update",
    "structure_axis.view", "structure_axis.update",
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
    "whatsapp.view", "whatsapp.send",
    "leave_types.view", "leave_types.manage",
    "leave_requests.view", "leave_requests.create", "leave_requests.update", "leave_requests.approve",
    "comp_off_credits.view", "comp_off_credits.grant",
    "expense_types.view", "expense_types.manage",
    "expense_claims.view", "expense_claims.create", "expense_claims.update", "expense_claims.approve", "expense_claims.mark_paid",
    "message_templates.view", "message_templates.manage",
    "pipeline_stages.view", "pipeline_stages.manage",
    "lead_categories.view", "lead_categories.manage",
    "assignment_rules.view", "assignment_rules.manage",
    "app_settings.view", "app_settings.manage",
    "qr_campaigns.view", "qr_campaigns.manage",
    "audit_log.view",
    "team_dashboard.view",
    "website_lead_sources.view", "website_lead_sources.manage",
    "quotes.view", "quotes.create", "quotes.update",
    "leads.export", "opportunities.export", "reports.export", "audit_log.export",
    "user_commissions.view", "user_commissions.create", "user_commissions.delete",
    "customers.view", "customers.create", "customers.update", "customers.delete",
    "call_center.view",
    "support_tickets.view", "support_tickets.create", "support_tickets.update", "support_tickets.delete",
  ],
  [ROLES.MANAGER]: [
    "users.view",
    "leads.view", "leads.create", "leads.update", "leads.delete", "leads.share",
    "opportunities.view", "opportunities.create", "opportunities.update", "opportunities.delete",
    "activities.view", "activities.create", "activities.update", "activities.delete",
    "attendance.view_own", "attendance.view_team",
    "dashboard.view",
    "offices.view", "offices.create", "offices.update",
    "levels.view", "levels.create", "levels.update",
    "structure_axis.view", "structure_axis.update",
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
    "whatsapp.view", "whatsapp.send",
    "leave_types.view",
    "leave_requests.view", "leave_requests.create", "leave_requests.update", "leave_requests.approve",
    "comp_off_credits.view", "comp_off_credits.grant",
    "expense_types.view",
    "expense_claims.view", "expense_claims.create", "expense_claims.update", "expense_claims.approve",
    "message_templates.view",
    "pipeline_stages.view",
    "lead_categories.view",
    "assignment_rules.view",
    "app_settings.view",
    "qr_campaigns.view",
    "audit_log.view",
    "team_dashboard.view",
    "website_lead_sources.view",
    "quotes.view", "quotes.create", "quotes.update",
    "leads.export", "opportunities.export", "reports.export", "audit_log.export",
    "user_commissions.view",
    "customers.view", "customers.create", "customers.update", "customers.delete",
    "call_center.view",
    "support_tickets.view", "support_tickets.create", "support_tickets.update",
  ],
  [ROLES.AGENT]: [
    "leads.view", "leads.create", "leads.update", "leads.delete", "leads.share",
    "opportunities.view", "opportunities.create", "opportunities.update", "opportunities.delete",
    "activities.view", "activities.create", "activities.update", "activities.delete",
    "attendance.view_own", "attendance.view_team",
    "dashboard.view",
    "offices.view",
    "levels.view",
    "structure_axis.view",
    "sales_teams.view",
    "fofo_onboarding.view", "fofo_onboarding.upload_document",
    "whatsapp.view", "whatsapp.send",
    "leave_types.view",
    "leave_requests.view", "leave_requests.create", "leave_requests.update",
    "comp_off_credits.view",
    "expense_types.view",
    "expense_claims.view", "expense_claims.create", "expense_claims.update",
    "message_templates.view",
    "pipeline_stages.view",
    "lead_categories.view",
    "quotes.view", "quotes.create", "quotes.update",
    "customers.view", "customers.create", "customers.update", "customers.delete",
    "call_center.view",
    "support_tickets.view", "support_tickets.create", "support_tickets.update",
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
  // Same DEFAULT_ROLE_PERMISSIONS "Reset role to default" already uses -
  // shipped here too so the screen can mark a cell "edited" (live grant
  // differs from the factory default) without a second round-trip.
  return { catalog, roles: Object.values(ROLES), grants, defaults: DEFAULT_ROLE_PERMISSIONS };
}

// The one permission that can never be allowed to reach zero holders: it's
// what lets anyone reach this screen's own write path (role-permission-routes
// now gates PATCH/reset on requirePermission like everything else, per the
// "no hardcoded exceptions" decision), so losing it everywhere would be a
// real, un-recoverable lockout - no UI left to grant it back. Nothing else
// gets this guard; recovery from any other mistake is always possible by
// coming back here and re-granting it, as long as this one permission
// survives somewhere.
const CRITICAL_PERMISSION = "role_permissions.update";

async function wouldOrphanCriticalPermission(roleBeingChanged: string): Promise<boolean> {
  const others = await pool.query<{ role: string }>(
    "SELECT DISTINCT role FROM role_permissions WHERE permission = $1 AND role <> $2",
    [CRITICAL_PERMISSION, roleBeingChanged]
  );
  return others.rows.length === 0;
}

// Live: getPermissionsForRole reads this same table with no caching, so a
// grant/revoke here takes effect on the very next request for every
// requirePermission-gated route - which, after the Phase 2 migration, is
// every route that used to be a hardcoded requireRole check.
export async function setRolePermission(role: string, permission: string, granted: boolean): Promise<void> {
  if (!granted && permission === CRITICAL_PERMISSION && (await wouldOrphanCriticalPermission(role))) {
    throw new ApiError(409, "At least one role must always be able to manage permissions - grant it to another role first.");
  }
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
  if (!defaults.includes(CRITICAL_PERMISSION) && (await wouldOrphanCriticalPermission(role))) {
    throw new ApiError(409, "Resetting this role would leave no role able to manage permissions - grant role_permissions.update to another role first.");
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
