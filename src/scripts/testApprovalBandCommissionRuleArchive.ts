import { pool } from "../config/db";
import { createApprovalBand, listApprovalBands, deleteApprovalBand, restoreApprovalBand } from "../services/approval-band-service";
import { createIncentivePlan, deleteIncentivePlan } from "../services/incentive-plan-service";
import { createCommissionRule, listCommissionRules, deleteCommissionRule, restoreCommissionRule } from "../services/commission-rule-service";

// Covers the same gap as Leads/Opportunities: Approval bands and Commission
// rules already had a correct is_deleted-based archive (deleteApprovalBand/
// deleteCommissionRule), but no "archived" list filter and no restore
// endpoint existed. Fixed with the same pattern.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const createdBandIds: string[] = [];
  let incentivePlanId: string | null = null;
  const createdRuleIds: string[] = [];

  try {
    // --- Approval bands ---
    const band = await createApprovalBand({
      requestType: "discount",
      bandName: "Archive Restore Test Band",
      rangeFrom: 0,
      rangeTo: 1000,
    });
    createdBandIds.push(band.id);

    const activeBefore = await listApprovalBands({ page: 1, limit: 200 });
    assertTrue("Band appears in the active list before archiving", activeBefore.approvalBands.some((b) => b.id === band.id));

    await deleteApprovalBand(band.id);

    const activeAfter = await listApprovalBands({ page: 1, limit: 200 });
    assertTrue("Band no longer appears in the active list after archiving", !activeAfter.approvalBands.some((b) => b.id === band.id));

    const archivedList = await listApprovalBands({ archived: true, page: 1, limit: 200 });
    assertTrue("Band appears in the archived list", archivedList.approvalBands.some((b) => b.id === band.id));

    await restoreApprovalBand(band.id);

    const activeRestored = await listApprovalBands({ page: 1, limit: 200 });
    assertTrue("Band is back in the active list after restoring", activeRestored.approvalBands.some((b) => b.id === band.id));

    const archivedAfterRestore = await listApprovalBands({ archived: true, page: 1, limit: 200 });
    assertTrue("Band no longer appears in the archived list after restoring", !archivedAfterRestore.approvalBands.some((b) => b.id === band.id));

    // --- Commission rules ---
    const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
    const testadminId = testadmin.rows[0].id;

    const plan = await createIncentivePlan(
      { name: `Archive Restore Test Plan ${Date.now()}`, effectiveStartDate: "2026-01-01" },
      testadminId
    );
    incentivePlanId = plan.id;

    const rule = await createCommissionRule({ incentivePlanId, name: "Archive Restore Test Rule" }, testadminId);
    createdRuleIds.push(rule.id);

    const ruleActiveBefore = await listCommissionRules({ incentivePlanId, page: 1, limit: 200 });
    assertTrue("Rule appears in the active list before archiving", ruleActiveBefore.commissionRules.some((r) => r.id === rule.id));

    await deleteCommissionRule(rule.id);

    const ruleActiveAfter = await listCommissionRules({ incentivePlanId, page: 1, limit: 200 });
    assertTrue("Rule no longer appears in the active list after archiving", !ruleActiveAfter.commissionRules.some((r) => r.id === rule.id));

    const ruleArchivedList = await listCommissionRules({ incentivePlanId, archived: true, page: 1, limit: 200 });
    assertTrue("Rule appears in the archived list", ruleArchivedList.commissionRules.some((r) => r.id === rule.id));

    await restoreCommissionRule(rule.id);

    const ruleActiveRestored = await listCommissionRules({ incentivePlanId, page: 1, limit: 200 });
    assertTrue("Rule is back in the active list after restoring", ruleActiveRestored.commissionRules.some((r) => r.id === rule.id));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdRuleIds.length > 0) {
      await pool.query("DELETE FROM commission_rules WHERE id = ANY($1::uuid[])", [createdRuleIds]);
    }
    if (incentivePlanId) {
      await deleteIncentivePlan(incentivePlanId).catch(() => undefined);
      await pool.query("DELETE FROM incentive_plans WHERE id = $1", [incentivePlanId]);
    }
    if (createdBandIds.length > 0) {
      await pool.query("DELETE FROM approval_bands WHERE id = ANY($1::uuid[])", [createdBandIds]);
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
