import { pool } from "../config/db";
import { createLead, isLeadVisibleToUser, listLeadsHandedOffByUser } from "../services/lead-service";
import { escalateToSlc, qualifyLead, sendToField, logCallDisposition } from "../services/lead-call-center-service";
import { globalSearch } from "../services/global-search-service";

// Verifies the client-confirmed, explicit follow-up to today's "universal
// FLC/SLC visibility" rule: every active Call Center Executive can look up
// ANY lead forever - read-only - even long after it's left the Call Center
// floor (Qualified, sent to Field Sales, whatever happens after). This is
// deliberately NOT owner scope (can't call/edit/act on it any more), and
// deliberately NOT extended to Opportunities in global search (Call Center
// holds no opportunities.view permission at all).

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

async function main(): Promise<void> {
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;
  const cc2 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc2@test.local'");
  const cc2Id = cc2.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    // cc1 walks a lead all the way through to Field Sales - cc2 never
    // touches it and has no personal lead_shares grant on it.
    const lead = await createLead(
      { fullName: "Universal Visibility Test", phone: "9876500051" },
      cc1Id,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    createdLeadIds.push(lead.id);
    assertEqual("assignToCreator lands directly at FLC", lead.status, "FLC");
    await escalateToSlc(lead.id, cc1Id);
    await logCallDisposition(lead.id, { disposition: "Call Done And Interested" }, cc1Id);
    await qualifyLead(lead.id, cc1Id);
    await sendToField(lead.id, cc1Id, undefined);
    const ownerCheck = await pool.query<{ role: string }>(
      "SELECT u.role FROM leads l JOIN users u ON u.id = l.owner_id WHERE l.id = $1",
      [lead.id]
    );
    assertEqual("Lead actually reached a field employee", ownerCheck.rows[0]?.role, "agent");

    assertTrue(
      "cc2 (never touched this lead, no personal share) can still SEE it after Field handoff",
      await isLeadVisibleToUser(lead.id, cc2Id)
    );

    const cc2HandedOff = await listLeadsHandedOffByUser(cc2Id);
    assertTrue(
      "cc2's 'Already handed off' list includes a lead cc1 sent to field, not just cc2's own",
      cc2HandedOff.some((l) => l.id === lead.id)
    );
    const handedOffEntry = cc2HandedOff.find((l) => l.id === lead.id);
    assertEqual("cc2 sees it read-only (not in owner scope)", handedOffEntry?.inOwnerScope, false);

    const searchResult = await globalSearch(cc2Id, "Universal Visibility Test");
    assertTrue(
      "cc2 can find this lead via global search even though they never owned/shared it",
      searchResult.leads.some((l) => l.id === lead.id)
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM lead_shares WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
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
