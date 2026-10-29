import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { escalateToSlc, qualifyLead, sendToField, logCallDisposition } from "../services/lead-call-center-service";
import { createActivityForLead } from "../services/activity-service";
import { getCallCenterPerformance, getFieldSalesPerformance } from "../services/report-service";

// Verifies the new Call Center/Field Sales performance reports: real calls,
// an escalation, a qualification, a field handoff and a site visit, all
// logged through the real service functions, must add up correctly per
// person - and both the employeeIds and date-range filters must actually
// narrow the result set, not just be accepted and ignored.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function idOf(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return result.rows[0].id;
}

async function main(): Promise<void> {
  const cc1Id = await idOf("cc1@test.local");
  const cc2Id = await idOf("cc2@test.local");
  const adminId = await idOf("admin@fieldforce.local");

  const leadIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Baseline before this test creates anything - every assertion below
  // compares against the delta, not an absolute count, so this test stays
  // correct even if some other test script run today left its own real
  // activity/escalation rows behind (exactly what testTlcRemoval.ts used to
  // do before its own cleanup was fixed - see that script's own comment).
  const before = await getCallCenterPerformance(adminId, { from: today, to: today, employeeIds: [cc1Id] });
  const cc1Before = before.find((r) => r.userId === cc1Id);
  const baselineCalls = cc1Before?.callsMade ?? 0;
  const baselineLeadsCalled = cc1Before?.leadsCalled ?? 0;
  const baselineEscalated = cc1Before?.escalatedOrQualified ?? 0;

  // cc1 (FLC): 3 calls with distinct dispositions on 2 distinct leads, escalates one of them.
  const leadA = await createLead({ fullName: "Perf Test A", phone: "9876500051" }, cc1Id, undefined, {
    requiresQualification: true,
    assignToCreator: true,
  });
  const leadB = await createLead({ fullName: "Perf Test B", phone: "9876500052" }, cc1Id, undefined, {
    requiresQualification: true,
    assignToCreator: true,
  });
  leadIds.push(leadA.id, leadB.id);
  await logCallDisposition(leadA.id, { disposition: "Ringing" }, cc1Id);
  await logCallDisposition(leadA.id, { disposition: "Call Done And Interested" }, cc1Id);
  await logCallDisposition(leadB.id, { disposition: "Not Reachable" }, cc1Id);
  const afterEscalate = await escalateToSlc(leadA.id, cc1Id);
  const slcOwnerId = afterEscalate.ownerId!;

  // Whoever actually received leadA at SLC qualifies it (SLC -> Qualified),
  // then sends it to Field (fallback path, no pincode on these test leads).
  await qualifyLead(leadA.id, slcOwnerId);
  const afterSend = await sendToField(leadA.id, slcOwnerId, undefined);
  const fieldOwnerId = afterSend.ownerId!;
  await createActivityForLead(leadA.id, { type: "site_visit", status: "completed" }, fieldOwnerId);

  const ccReport = await getCallCenterPerformance(adminId, { from: today, to: today });
  const cc1Row = ccReport.find((r) => r.userId === cc1Id);
  assertTrue("Call Center report includes cc1", Boolean(cc1Row));
  assertEqual("cc1 calls made (delta)", (cc1Row?.callsMade ?? 0) - baselineCalls, 3);
  assertEqual("cc1 Ringing count", cc1Row?.dispositions.ringing, 1 + (cc1Before?.dispositions.ringing ?? 0));
  assertEqual("cc1 Interested count", cc1Row?.dispositions.interested, 1 + (cc1Before?.dispositions.interested ?? 0));
  assertEqual("cc1 Not Reachable count", cc1Row?.dispositions.notReachable, 1 + (cc1Before?.dispositions.notReachable ?? 0));
  assertEqual("cc1 distinct leads called (delta)", (cc1Row?.leadsCalled ?? 0) - baselineLeadsCalled, 2);
  assertEqual("cc1 escalated count (delta)", (cc1Row?.escalatedOrQualified ?? 0) - baselineEscalated, 1);

  const ccReportFiltered = await getCallCenterPerformance(adminId, { from: today, to: today, employeeIds: [cc2Id] });
  assertTrue("employeeIds filter excludes cc1 when only cc2 is requested", !ccReportFiltered.some((r) => r.userId === cc1Id));

  const pastOnly = await getCallCenterPerformance(adminId, { from: "2000-01-01", to: "2000-01-02" });
  assertTrue("A date range with no activity in it returns no calls for cc1", !pastOnly.some((r) => r.userId === cc1Id && r.callsMade > 0));

  const fsReport = await getFieldSalesPerformance(adminId, { from: today, to: today });
  const fieldRow = fsReport.find((r) => r.userId === fieldOwnerId);
  assertTrue("Field Sales report includes the receiving agent", Boolean(fieldRow));
  assertTrue("Field agent's leadsReceived is at least 1", (fieldRow?.leadsReceived ?? 0) >= 1);
  assertEqual("Field agent's site visits logged", fieldRow?.siteVisitsLogged, 1);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1)", [leadIds]);
  await pool.query("DELETE FROM activities WHERE lead_id = ANY($1)", [leadIds]);
  await pool.query("DELETE FROM leads WHERE id = ANY($1)", [leadIds]);

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
