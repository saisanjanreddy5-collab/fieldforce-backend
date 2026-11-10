import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { escalateToSlc, logCallDisposition, qualifyLead } from "../services/lead-call-center-service";
import { ApiError } from "../utils/ApiError";

// Covers the real reported bug: "After entering call details for an SLC
// Lead, the Lead is automatically converted, even when the call disposition
// is marked as Not Reachable." Root cause: the "Mark Qualified" action had
// no connection at all to what the most recent logged call outcome was -
// only the lead's stage was checked. Fixed by requiring the last logged
// call's disposition to actually be "Call Done And Interested" before
// qualifyLead will succeed, both here (the real enforcement) and as a
// disabled button + tooltip on the frontend (CallCenterStageActions.tsx).

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
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    // --- A lead with NO call ever logged cannot be qualified ---
    const leadNoCall = await createLead(
      { fullName: "Qualify Guard Test - No Call Logged", phone: "9876500071" },
      cc1Id,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    createdLeadIds.push(leadNoCall.id);
    await escalateToSlc(leadNoCall.id, cc1Id);
    await expectRejected("Qualify rejected with no call ever logged", qualifyLead(leadNoCall.id, cc1Id));

    // --- A lead whose last call was "Not Reachable" cannot be qualified ---
    const leadNotReachable = await createLead(
      { fullName: "Qualify Guard Test - Not Reachable", phone: "9876500072" },
      cc1Id,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    createdLeadIds.push(leadNotReachable.id);
    await escalateToSlc(leadNotReachable.id, cc1Id);
    await logCallDisposition(leadNotReachable.id, { disposition: "Not Reachable" }, cc1Id);
    await expectRejected(
      "Qualify rejected when last call outcome is 'Not Reachable'",
      qualifyLead(leadNotReachable.id, cc1Id)
    );

    // --- A lead whose last call was "Call Done And Not Interested" cannot be qualified ---
    const leadNotInterested = await createLead(
      { fullName: "Qualify Guard Test - Not Interested", phone: "9876500073" },
      cc1Id,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    createdLeadIds.push(leadNotInterested.id);
    await escalateToSlc(leadNotInterested.id, cc1Id);
    await logCallDisposition(leadNotInterested.id, { disposition: "Call Done And Not Interested" }, cc1Id);
    await expectRejected(
      "Qualify rejected when last call outcome is 'Call Done And Not Interested'",
      qualifyLead(leadNotInterested.id, cc1Id)
    );

    // --- A lead with a real "Call Done And Interested" call succeeds ---
    const leadInterested = await createLead(
      { fullName: "Qualify Guard Test - Interested", phone: "9876500074" },
      cc1Id,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    createdLeadIds.push(leadInterested.id);
    await escalateToSlc(leadInterested.id, cc1Id);
    await logCallDisposition(leadInterested.id, { disposition: "Call Done And Interested" }, cc1Id);
    const qualified = await qualifyLead(leadInterested.id, cc1Id);
    assertTrue("Qualify succeeds when last call outcome is 'Call Done And Interested'", qualified.status === "Qualified");

    // --- A later "Not Reachable" call AFTER an earlier "Interested" call blocks it again ---
    // (confirms the check looks at the MOST RECENT outcome, not "ever interested at some point")
    const leadFlipFlop = await createLead(
      { fullName: "Qualify Guard Test - Flip Flop", phone: "9876500075" },
      cc1Id,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    createdLeadIds.push(leadFlipFlop.id);
    await escalateToSlc(leadFlipFlop.id, cc1Id);
    await logCallDisposition(leadFlipFlop.id, { disposition: "Call Done And Interested" }, cc1Id);
    await logCallDisposition(leadFlipFlop.id, { disposition: "Not Reachable" }, cc1Id);
    await expectRejected(
      "Qualify rejected when the MOST RECENT call outcome regressed to 'Not Reachable'",
      qualifyLead(leadFlipFlop.id, cc1Id)
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
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
