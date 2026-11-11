import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { convertLeadToOpportunity, listOpportunityHistory, updateOpportunity } from "../services/opportunity-service";

// Covers "Created By Details Missing in Opportunity History" - the
// opportunities.created_by column was always correct, but History only ever
// reads from audit_log, and nothing wrote a row there for the creation
// event itself (only later stage changes did). Fixed by logging a real
// "created" audit event right after the INSERT, folding the creator's role
// into the free-text summary rather than adding a new column.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string; name: string; role: string }>(
    "SELECT id, name, role FROM users WHERE email = 'testadmin@test.local'"
  );
  const testadminId = testadmin.rows[0].id;
  const testadminName = testadmin.rows[0].name;
  const testadminRole = testadmin.rows[0].role;

  const createdLeadIds: string[] = [];

  try {
    const lead = await createLead({ fullName: "Opportunity Creation History Test" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    // Opportunity creation now requires the lead to actually be with Field
    // Sales (owner's role = agent, not just stage = Qualified). testadminId
    // (role admin) bypasses the owner-scope check regardless of who owns
    // the lead, so any active agent works here.
    const fieldAgent = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'agent' AND is_active = true LIMIT 1");
    await pool.query("UPDATE leads SET status = 'Qualified', owner_id = $1 WHERE id = $2", [fieldAgent.rows[0].id, lead.id]);

    const opp = await convertLeadToOpportunity(lead.id, { name: "Creation History Test Opp" }, testadminId);

    const historyAfterCreate = await listOpportunityHistory(opp.id, testadminId);
    assertTrue("History has exactly one entry right after creation", historyAfterCreate.length === 1);
    const createdEntry = historyAfterCreate[0];
    assertTrue("Creation entry has action 'created'", createdEntry.action === "created");
    assertTrue("Creation entry's summary names the real creator", createdEntry.summary.includes(testadminName));
    assertTrue("Creation entry's summary names the real creator's role", createdEntry.summary.includes(testadminRole));
    assertTrue("Creation entry's actorName is the real creator", createdEntry.actorName === testadminName);
    assertTrue("Creation entry has no oldValue/newValue (not a stage move)", createdEntry.oldValue === null && createdEntry.newValue === null);

    // A later real stage change should ADD to history, not replace the creation event.
    await updateOpportunity(opp.id, { stage: "proposal" }, testadminId);
    const historyAfterStageChange = await listOpportunityHistory(opp.id, testadminId);
    assertTrue("History now has both the creation and the stage-change entries", historyAfterStageChange.length === 2);
    assertTrue(
      "The creation entry is still present after a later stage change",
      historyAfterStageChange.some((e) => e.action === "created")
    );
    assertTrue(
      "The stage-change entry is also present",
      historyAfterStageChange.some((e) => e.action === "stage_changed")
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'opportunity' AND entity_id IN (SELECT id FROM opportunities WHERE lead_id = ANY($1::uuid[]))", [createdLeadIds]);
      await pool.query("DELETE FROM opportunities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM customers WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
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
