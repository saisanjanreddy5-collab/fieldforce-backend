import { pool } from "../config/db";
import { createDelegation, listDelegations, deleteDelegation, restoreDelegation } from "../services/delegation-service";
import { createTarget, listTargets, deleteTarget, restoreTarget, getTargetById } from "../services/target-service";
import { ROLES } from "../utils/roles";

// Covers the client-reported gap: Delegations and Targets already had a
// correct, working soft-delete endpoint (is_deleted = true, never a real
// DELETE), but no UI anywhere showed what got archived or let it come back.
// Fixed with an "archived" list filter (flips is_deleted = false -> true,
// never both mixed) plus a dedicated restore endpoint for both - same
// pattern as Leads/Opportunities earlier in this session.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;

  let delegationId: string | null = null;
  let targetId: string | null = null;

  try {
    // --- Delegations ---
    const delegation = await createDelegation(
      { userId: testadminId, delegateId: cc1Id, startDate: "2031-01-01", endDate: "2031-01-10" },
      testadminId
    );
    delegationId = delegation.id;

    const activeBefore = await listDelegations({ page: 1, limit: 200 });
    assertTrue("Delegation appears in the active list before archiving", activeBefore.delegations.some((d) => d.id === delegationId));

    await deleteDelegation(delegationId);

    const activeAfter = await listDelegations({ page: 1, limit: 200 });
    assertTrue("Delegation no longer appears in the active list after archiving", !activeAfter.delegations.some((d) => d.id === delegationId));

    const archivedList = await listDelegations({ archived: true, page: 1, limit: 200 });
    assertTrue("Delegation appears in the archived list", archivedList.delegations.some((d) => d.id === delegationId));

    await restoreDelegation(delegationId);

    const activeRestored = await listDelegations({ page: 1, limit: 200 });
    assertTrue("Delegation is back in the active list after restoring", activeRestored.delegations.some((d) => d.id === delegationId));

    const archivedAfterRestore = await listDelegations({ archived: true, page: 1, limit: 200 });
    assertTrue(
      "Delegation no longer appears in the archived list after restoring",
      !archivedAfterRestore.delegations.some((d) => d.id === delegationId)
    );

    // --- Targets --- (a distant, unlikely-to-collide future annual period)
    const target = await createTarget(
      { userId: testadminId, periodType: "annual", periodAnchor: "2099-06-15", targetAmount: 5000000 },
      testadminId
    );
    targetId = target.id;

    const targetsActiveBefore = await listTargets(testadminId, ROLES.ADMIN, { page: 1, limit: 200 });
    assertTrue("Target appears in the active list before archiving", targetsActiveBefore.targets.some((t) => t.id === targetId));

    await deleteTarget(targetId);

    const targetsActiveAfter = await listTargets(testadminId, ROLES.ADMIN, { page: 1, limit: 200 });
    assertTrue("Target no longer appears in the active list after archiving", !targetsActiveAfter.targets.some((t) => t.id === targetId));

    const targetsArchivedList = await listTargets(testadminId, ROLES.ADMIN, { archived: true, page: 1, limit: 200 });
    assertTrue("Target appears in the archived list", targetsArchivedList.targets.some((t) => t.id === targetId));

    await restoreTarget(targetId);

    const targetsActiveRestored = await listTargets(testadminId, ROLES.ADMIN, { page: 1, limit: 200 });
    assertTrue("Target is back in the active list after restoring", targetsActiveRestored.targets.some((t) => t.id === targetId));

    const restoredTarget = await getTargetById(targetId, testadminId, ROLES.ADMIN);
    assertTrue("Restored target is reachable by id again", restoredTarget.id === targetId);

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (delegationId) {
      await pool.query("DELETE FROM delegations WHERE id = $1", [delegationId]);
    }
    if (targetId) {
      await pool.query("DELETE FROM targets WHERE id = $1", [targetId]);
    }
  }

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
