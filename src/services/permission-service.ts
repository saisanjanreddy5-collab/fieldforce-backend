import { pool } from "../config/db";

// What someone may do = their role's permissions (role_permissions), then
// their own active per-user overrides on top (user_permission_overrides:
// "grant" adds one, "revoke" removes one; later overrides win; expired or
// cleared ones don't count). This is the check behind every
// requirePermission route, so it runs on almost every request - both parts
// are kept in memory. Every write to either table clears the cache at once
// (clearPermissionCache); the short expiry covers changes made outside this
// process (e.g. a second server).
const CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { permissions: string[]; loadedAt: number }>();
const userCache = new Map<
  string,
  { role: string; isActive: boolean; overrides: { permission: string; grant: boolean }[]; validUntil: number }
>();

export async function getPermissionsForRole(role: string): Promise<string[]> {
  const hit = roleCache.get(role);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.permissions;
  const result = await pool.query<{ permission: string }>(
    "SELECT permission FROM role_permissions WHERE role = $1 ORDER BY permission ASC",
    [role]
  );
  const permissions = result.rows.map((row) => row.permission);
  roleCache.set(role, { permissions, loadedAt: Date.now() });
  return permissions;
}

async function loadUser(userId: string) {
  const hit = userCache.get(userId);
  if (hit && Date.now() < hit.validUntil) return hit;
  const [userResult, overrideResult] = await Promise.all([
    pool.query<{ role: string; is_active: boolean }>("SELECT role, is_active FROM users WHERE id = $1", [userId]),
    pool.query<{ permission: string; grant_type: string; expires_at: Date | null }>(
      `SELECT permission, grant_type, expires_at FROM user_permission_overrides
       WHERE user_id = $1 AND cleared_at IS NULL AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at ASC`,
      [userId]
    ),
  ]);
  const row = userResult.rows[0];
  // Re-read as soon as the earliest override runs out, not up to 30 s later.
  const firstExpiry = Math.min(
    ...overrideResult.rows.filter((o) => o.expires_at).map((o) => new Date(o.expires_at as Date).getTime()),
    Date.now() + CACHE_TTL_MS
  );
  const entry = {
    role: row?.role ?? "",
    isActive: Boolean(row?.is_active),
    overrides: overrideResult.rows.map((o) => ({ permission: o.permission, grant: o.grant_type === "grant" })),
    validUntil: firstExpiry,
  };
  userCache.set(userId, entry);
  return entry;
}

/** A deactivated (or deleted) user gets no permissions at all. */
export async function getEffectivePermissions(userId: string): Promise<{ isActive: boolean; permissions: string[] }> {
  const user = await loadUser(userId);
  if (!user.isActive) return { isActive: false, permissions: [] };
  const effective = new Set(await getPermissionsForRole(user.role));
  for (const override of user.overrides) {
    if (override.grant) effective.add(override.permission);
    else effective.delete(override.permission);
  }
  return { isActive: true, permissions: [...effective].sort() };
}

export function clearPermissionCache(): void {
  roleCache.clear();
  userCache.clear();
}
