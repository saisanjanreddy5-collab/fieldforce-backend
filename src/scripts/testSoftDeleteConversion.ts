import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { createTarget, listTargets, deleteTarget } from "../services/target-service";
import { createDelegation, listDelegations, deleteDelegation } from "../services/delegation-service";
import { ROLES } from "../utils/roles";

// Spot-checks the "no permanent delete, archive instead" conversion across
// two representative modules (Targets: admin-wide + subtree-scoped reads,
// Delegations: a flat admin-only list) - same mechanical pattern was applied
// to 13 modules total; these two exercise the pattern end to end rather than
// re-testing each module's own already-type-checked, reviewed conversion.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function findOrCreateUser(email: string, name: string, role: (typeof ROLES)[keyof typeof ROLES]): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const user = await registerUser({ name, email, password: "Password123", role });
  return user.id;
}

async function main(): Promise<void> {
  const adminId = await findOrCreateUser("softdelete-admin.test@fieldforce.local", "Soft Delete Test Admin", ROLES.ADMIN);
  const personId = await findOrCreateUser("softdelete-person.test@fieldforce.local", "Soft Delete Test Person", ROLES.MANAGER);
  const delegateId = await findOrCreateUser("softdelete-delegate.test@fieldforce.local", "Soft Delete Test Delegate", ROLES.MANAGER);

  console.log("--- Targets ---");
  const target = await createTarget(
    { userId: personId, periodType: "monthly", periodAnchor: "2027-01-01", targetAmount: 100000 },
    adminId
  );
  const beforeDelete = await listTargets(adminId, ROLES.ADMIN, { userId: personId, page: 1, limit: 50 });
  assertEqual("Target appears in the list before archiving", beforeDelete.targets.some((t) => t.id === target.id), true);

  await deleteTarget(target.id);

  const afterDelete = await listTargets(adminId, ROLES.ADMIN, { userId: personId, page: 1, limit: 50 });
  assertEqual("Target no longer appears in the list after archiving", afterDelete.targets.some((t) => t.id === target.id), false);

  const rawRow = await pool.query<{ is_deleted: boolean }>("SELECT is_deleted FROM targets WHERE id = $1", [target.id]);
  assertEqual("Target row still physically exists in the database", rawRow.rows.length, 1);
  assertEqual("Target row is flagged is_deleted = true, not destroyed", rawRow.rows[0]?.is_deleted, true);

  let reDeleteThrew404 = false;
  try {
    await deleteTarget(target.id);
  } catch (err) {
    reDeleteThrew404 = (err as { statusCode?: number }).statusCode === 404;
  }
  assertEqual("Archiving an already-archived target 404s instead of silently succeeding again", reDeleteThrew404, true);

  console.log("\n--- Delegations ---");
  const delegation = await createDelegation(
    { userId: personId, delegateId, startDate: "2027-01-01", endDate: "2027-01-31" },
    adminId
  );
  const delegationsBefore = await listDelegations({ page: 1, limit: 100 });
  assertEqual("Delegation appears in the list before archiving", delegationsBefore.delegations.some((d) => d.id === delegation.id), true);

  await deleteDelegation(delegation.id);

  const delegationsAfter = await listDelegations({ page: 1, limit: 100 });
  assertEqual("Delegation no longer appears in the list after archiving", delegationsAfter.delegations.some((d) => d.id === delegation.id), false);

  const rawDelegationRow = await pool.query<{ is_deleted: boolean }>("SELECT is_deleted FROM delegations WHERE id = $1", [delegation.id]);
  assertEqual("Delegation row still physically exists in the database", rawDelegationRow.rows.length, 1);
  assertEqual("Delegation row is flagged is_deleted = true, not destroyed", rawDelegationRow.rows[0]?.is_deleted, true);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  // Permanent cleanup of the now-archived test rows (this script's own
  // ephemeral records, not the reusable fixture users).
  await pool.query("DELETE FROM targets WHERE id = $1", [target.id]);
  await pool.query("DELETE FROM delegations WHERE id = $1", [delegation.id]);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
