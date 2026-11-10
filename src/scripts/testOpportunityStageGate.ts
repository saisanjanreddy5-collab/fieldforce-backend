import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";
import { escalateToSlc, logCallDisposition, qualifyLead, startFlc } from "../services/lead-call-center-service";
import { ApiError } from "../utils/ApiError";

// Covers "Opportunity Creation Allowed for Leads in Call Center Stage 1" -
// convertLeadToOpportunity had zero check on the lead's own stage, so even
// Admin (who holds opportunities.create) could create one against a lead
// still at New/FLC/SLC - before Call Center had even qualified it. Fixed by
// requiring the lead to have actually reached Qualified (or later) first.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function expectRejected(label: string, promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    assertTrue(label, false);
  } catch (err) {
    assertTrue(label, err instanceof ApiError && err.statusCode === 422);
  }
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    // --- New stage: rejected ---
    const leadNew = await createLead({ fullName: "Stage Gate Test - New" }, testadminId, undefined, {});
    createdLeadIds.push(leadNew.id);
    assertTrue("Fresh lead starts at New", leadNew.status === "New");
    await expectRejected("Opportunity creation rejected at New stage", convertLeadToOpportunity(leadNew.id, {}, testadminId));

    // --- FLC stage: rejected ---
    const leadFlc = await createLead({ fullName: "Stage Gate Test - FLC" }, testadminId, undefined, {});
    createdLeadIds.push(leadFlc.id);
    await startFlc(leadFlc.id, testadminId);
    await expectRejected("Opportunity creation rejected at FLC stage", convertLeadToOpportunity(leadFlc.id, {}, testadminId));

    // --- SLC stage: rejected ---
    const leadSlc = await createLead({ fullName: "Stage Gate Test - SLC" }, testadminId, undefined, {});
    createdLeadIds.push(leadSlc.id);
    await startFlc(leadSlc.id, testadminId);
    await escalateToSlc(leadSlc.id, testadminId);
    await expectRejected("Opportunity creation rejected at SLC stage", convertLeadToOpportunity(leadSlc.id, {}, testadminId));

    // --- Qualified stage (reached for real, through the real pipeline): succeeds ---
    const leadQualified = await createLead({ fullName: "Stage Gate Test - Qualified" }, testadminId, undefined, {});
    createdLeadIds.push(leadQualified.id);
    await startFlc(leadQualified.id, testadminId);
    await escalateToSlc(leadQualified.id, testadminId);
    await logCallDisposition(leadQualified.id, { disposition: "Call Done And Interested" }, testadminId);
    await qualifyLead(leadQualified.id, testadminId);
    const opp = await convertLeadToOpportunity(leadQualified.id, { name: "Stage Gate Test Opp" }, testadminId);
    assertTrue("Opportunity creation succeeds once the lead is genuinely Qualified", Boolean(opp.id));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM opportunities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM customers WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type IN ('lead','opportunity') AND entity_id = ANY($1::uuid[])", [
        createdLeadIds,
      ]);
      await pool.query("DELETE FROM leads WHERE id = ANY($1::uuid[])", [createdLeadIds]);
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
