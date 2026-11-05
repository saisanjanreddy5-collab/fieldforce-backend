import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { createTicketForLead } from "../services/support-ticket-service";

// Covers the client-reported bug: the "New ticket" picker (and the backend
// behind it) let a support ticket be raised against ANY lead, at any stage -
// even one Call Center hadn't even qualified yet. Fixed in
// support-ticket-service.ts's createTicketForLead: only "Qualified" (a
// confirmed real lead, including once Field Sales owns it) or "Converted"
// (an actual won customer) leads are eligible.
//
// Deliberately never drives a Qualified/Converted lead through this function -
// Frappe is genuinely configured in this dev environment, and doing so would
// create a real ticket in that external system. The rejection path alone
// (New/FLC/SLC) proves the gate works, since it throws before ever reaching
// frappeService.createTicketInFrappe.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    // Lead A: freshly created, lands on "New" by default.
    const leadNew = await createLead({ fullName: "Ticket Eligibility Test - New" }, testadminId, undefined, {});
    createdLeadIds.push(leadNew.id);

    let newLeadError = "";
    try {
      await createTicketForLead(leadNew.id, "Test subject", undefined, "Medium", testadminId);
    } catch (err) {
      newLeadError = err instanceof Error ? err.message : String(err);
    }
    assertTrue("A ticket cannot be raised for a lead still at 'New'", newLeadError.toLowerCase().includes("qualified"));

    // Lead B: pushed into FLC directly (seeded, not via the real flow).
    const leadFlc = await createLead({ fullName: "Ticket Eligibility Test - FLC" }, testadminId, undefined, {});
    createdLeadIds.push(leadFlc.id);
    await pool.query("UPDATE leads SET status = 'FLC' WHERE id = $1", [leadFlc.id]);

    let flcLeadError = "";
    try {
      await createTicketForLead(leadFlc.id, "Test subject", undefined, "Medium", testadminId);
    } catch (err) {
      flcLeadError = err instanceof Error ? err.message : String(err);
    }
    assertTrue("A ticket cannot be raised for a lead still at 'FLC'", flcLeadError.toLowerCase().includes("qualified"));

    // Lead C: pushed into SLC directly.
    const leadSlc = await createLead({ fullName: "Ticket Eligibility Test - SLC" }, testadminId, undefined, {});
    createdLeadIds.push(leadSlc.id);
    await pool.query("UPDATE leads SET status = 'SLC' WHERE id = $1", [leadSlc.id]);

    let slcLeadError = "";
    try {
      await createTicketForLead(leadSlc.id, "Test subject", undefined, "Medium", testadminId);
    } catch (err) {
      slcLeadError = err instanceof Error ? err.message : String(err);
    }
    assertTrue("A ticket cannot be raised for a lead still at 'SLC'", slcLeadError.toLowerCase().includes("qualified"));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
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
