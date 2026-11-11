import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { escalateToSlc, logCallDisposition, qualifyLead, sendToField, startFlc } from "../services/lead-call-center-service";

// Covers the real bug behind "Send to Field Sales succeeds, but the screen
// keeps showing Owner: Unassigned and the button stays enabled" - every
// mutation here (qualifyLead, sendToField, escalateToSlc, startFlc, ...)
// goes through updateLead, whose own UPDATE...RETURNING query only ever
// selected leads' own columns - ownerName/ownerRole (both joined from
// users) came back undefined on the object handed straight back to the
// frontend, on every call, not just an owner change. A caller that trusts
// that response instead of blindly re-fetching the whole list (exactly
// what today's performance fix intentionally does) would show stale
// owner info. Fixed by joining users/leads into updateLead's own RETURNING
// via a writable CTE, same fields getLeadById already computes the same way.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;
  const testadminName = (await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [testadminId])).rows[0].name;

  const createdLeadIds: string[] = [];

  try {
    const lead = await createLead({ fullName: "Owner Display Test Lead" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);

    const afterFlc = await startFlc(lead.id, testadminId);
    assertEqual("startFlc: ownerName is the real owner's name, not undefined/null", afterFlc.ownerName, testadminName);

    const afterSlc = await escalateToSlc(lead.id, testadminId);
    assertEqual("escalateToSlc: ownerName is still populated", afterSlc.ownerName, testadminName);

    await logCallDisposition(lead.id, { disposition: "Call Done And Interested" }, testadminId);
    const afterQualify = await qualifyLead(lead.id, testadminId);
    assertEqual("qualifyLead: ownerName is populated (new owner = the qualifier)", afterQualify.ownerName, testadminName);
    assertTrue("qualifyLead: ownerRole is populated, not undefined", afterQualify.ownerRole !== undefined && afterQualify.ownerRole !== null);

    const afterSend = await sendToField(lead.id, testadminId, undefined);
    assertTrue("sendToField: ownerId is a real id (not null)", Boolean(afterSend.ownerId));
    assertTrue("sendToField: ownerName is a real name, not undefined/null (the actual reported bug)", Boolean(afterSend.ownerName));
    assertEqual("sendToField: ownerRole is 'agent' (this is what the Send to Field Sales button's own disabled-check reads)", afterSend.ownerRole, "agent");

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM lead_shares WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
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
