import { pool } from "../config/db";
import { createUserCommission, deleteUserCommission, listUserCommissions, restoreUserCommission } from "../services/user-commission-service";
import { createIncentivePlan } from "../services/incentive-plan-service";
import {
  createUserIncentivePlan,
  deleteUserIncentivePlan,
  listUserIncentivePlans,
  restoreUserIncentivePlan,
} from "../services/user-incentive-plan-service";
import { ROLES } from "../utils/roles";

// Covers the client-reported gap for User commissions and User incentive
// plan assignments - same pattern as Leads/Opportunities earlier this
// session: a correct is_deleted-backed archive already existed, but no way
// to see what got archived or bring it back. Fixed with an `archived` list
// filter (flips is_deleted = false -> true, never mixed) plus a restore
// endpoint for both.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  let userCommissionId: string | null = null;
  let userIncentivePlanId: string | null = null;
  let incentivePlanId: string | null = null;

  try {
    // --- User commission ---
    const commission = await createUserCommission(
      { userId: testadminId, basis: "collected_revenue", payoutCycle: "monthly" },
      testadminId
    );
    userCommissionId = commission.id;

    const activeBefore = await listUserCommissions(testadminId, ROLES.ADMIN, { userId: testadminId, page: 1, limit: 100 });
    assertTrue("User commission appears in the active list before archiving", activeBefore.userCommissions.some((c) => c.id === commission.id));

    await deleteUserCommission(commission.id);

    const activeAfter = await listUserCommissions(testadminId, ROLES.ADMIN, { userId: testadminId, page: 1, limit: 100 });
    assertTrue("User commission no longer appears in the active list after archiving", !activeAfter.userCommissions.some((c) => c.id === commission.id));

    const archivedList = await listUserCommissions(testadminId, ROLES.ADMIN, { userId: testadminId, archived: true, page: 1, limit: 100 });
    assertTrue("User commission appears in the archived list", archivedList.userCommissions.some((c) => c.id === commission.id));

    await restoreUserCommission(commission.id);

    const activeRestored = await listUserCommissions(testadminId, ROLES.ADMIN, { userId: testadminId, page: 1, limit: 100 });
    assertTrue("User commission is back in the active list after restoring", activeRestored.userCommissions.some((c) => c.id === commission.id));

    const archivedAfterRestore = await listUserCommissions(testadminId, ROLES.ADMIN, { userId: testadminId, archived: true, page: 1, limit: 100 });
    assertTrue(
      "User commission no longer appears in the archived list after restoring",
      !archivedAfterRestore.userCommissions.some((c) => c.id === commission.id)
    );

    // --- User incentive plan (needs a real incentive plan to attach to) ---
    const plan = await createIncentivePlan(
      { name: `Archive Restore Test Plan ${Date.now()}`, effectiveStartDate: "2026-01-01" },
      testadminId
    );
    incentivePlanId = plan.id;

    const assignment = await createUserIncentivePlan(
      { userId: testadminId, incentivePlanId: plan.id, effectiveStartDate: "2026-01-01" },
      testadminId
    );
    userIncentivePlanId = assignment.id;

    const planActiveBefore = await listUserIncentivePlans(testadminId, ROLES.ADMIN, { userId: testadminId, page: 1, limit: 100 });
    assertTrue(
      "User incentive plan appears in the active list before archiving",
      planActiveBefore.userIncentivePlans.some((a) => a.id === assignment.id)
    );

    await deleteUserIncentivePlan(assignment.id);

    const planActiveAfter = await listUserIncentivePlans(testadminId, ROLES.ADMIN, { userId: testadminId, page: 1, limit: 100 });
    assertTrue(
      "User incentive plan no longer appears in the active list after archiving",
      !planActiveAfter.userIncentivePlans.some((a) => a.id === assignment.id)
    );

    const planArchivedList = await listUserIncentivePlans(testadminId, ROLES.ADMIN, {
      userId: testadminId,
      archived: true,
      page: 1,
      limit: 100,
    });
    assertTrue("User incentive plan appears in the archived list", planArchivedList.userIncentivePlans.some((a) => a.id === assignment.id));

    await restoreUserIncentivePlan(assignment.id);

    const planActiveRestored = await listUserIncentivePlans(testadminId, ROLES.ADMIN, { userId: testadminId, page: 1, limit: 100 });
    assertTrue(
      "User incentive plan is back in the active list after restoring",
      planActiveRestored.userIncentivePlans.some((a) => a.id === assignment.id)
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (userCommissionId) {
      await pool.query("DELETE FROM user_commissions WHERE id = $1", [userCommissionId]);
    }
    if (userIncentivePlanId) {
      await pool.query("DELETE FROM user_incentive_plans WHERE id = $1", [userIncentivePlanId]);
    }
    if (incentivePlanId) {
      await pool.query("DELETE FROM incentive_plans WHERE id = $1", [incentivePlanId]);
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
