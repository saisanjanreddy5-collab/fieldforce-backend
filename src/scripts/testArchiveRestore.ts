import { pool } from "../config/db";
import { createLead, listLeadsForUser, deleteLead, restoreLead } from "../services/lead-service";
import { convertLeadToOpportunity, listOpportunitiesForUser, deleteOpportunity, restoreOpportunity } from "../services/opportunity-service";

// Covers the client-reported gap: Leads and Opportunities already had a
// correct, working soft-delete endpoint (is_deleted = true, never a real
// DELETE), but no UI anywhere ever called it, and there was no way to see
// what got archived or bring it back. Fixed with an "archived" list filter
// (flips is_deleted = false -> true, never both mixed) plus a dedicated
// restore endpoint for both Leads and Opportunities.

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
    // --- Leads ---
    const lead = await createLead({ fullName: "Archive Restore Test Lead" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);

    const activeBefore = await listLeadsForUser(testadminId, { page: 1, limit: 100 });
    assertTrue("Lead appears in the active list before archiving", activeBefore.leads.some((l) => l.id === lead.id));

    await deleteLead(lead.id, testadminId);

    const activeAfter = await listLeadsForUser(testadminId, { page: 1, limit: 100 });
    assertTrue("Lead no longer appears in the active list after archiving", !activeAfter.leads.some((l) => l.id === lead.id));

    const archivedList = await listLeadsForUser(testadminId, { archived: true, page: 1, limit: 100 });
    assertTrue("Lead appears in the archived list", archivedList.leads.some((l) => l.id === lead.id));

    await restoreLead(lead.id, testadminId);

    const activeRestored = await listLeadsForUser(testadminId, { page: 1, limit: 100 });
    assertTrue("Lead is back in the active list after restoring", activeRestored.leads.some((l) => l.id === lead.id));

    const archivedAfterRestore = await listLeadsForUser(testadminId, { archived: true, page: 1, limit: 100 });
    assertTrue("Lead no longer appears in the archived list after restoring", !archivedAfterRestore.leads.some((l) => l.id === lead.id));

    // --- Opportunities ---
    // Opportunity creation now requires the lead to actually be with Field
    // Sales (owner's role = agent, not just stage = Qualified) - this test
    // is about archive/restore, not the Call Center pipeline. testadminId
    // (role admin) bypasses the owner-scope check regardless of who owns
    // the lead, so any active agent works here.
    const fieldAgent = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'agent' AND is_active = true LIMIT 1");
    await pool.query("UPDATE leads SET status = 'Qualified', owner_id = $1 WHERE id = $2", [fieldAgent.rows[0].id, lead.id]);
    const opp = await convertLeadToOpportunity(lead.id, {}, testadminId);

    const oppActiveBefore = await listOpportunitiesForUser(testadminId, { page: 1, limit: 100 });
    assertTrue("Opportunity appears in the active list before archiving", oppActiveBefore.opportunities.some((o) => o.id === opp.id));

    await deleteOpportunity(opp.id, testadminId);

    const oppActiveAfter = await listOpportunitiesForUser(testadminId, { page: 1, limit: 100 });
    assertTrue("Opportunity no longer appears in the active list after archiving", !oppActiveAfter.opportunities.some((o) => o.id === opp.id));

    const oppArchivedList = await listOpportunitiesForUser(testadminId, { archived: true, page: 1, limit: 100 });
    assertTrue("Opportunity appears in the archived list", oppArchivedList.opportunities.some((o) => o.id === opp.id));

    await restoreOpportunity(opp.id, testadminId);

    const oppActiveRestored = await listOpportunitiesForUser(testadminId, { page: 1, limit: 100 });
    assertTrue("Opportunity is back in the active list after restoring", oppActiveRestored.opportunities.some((o) => o.id === opp.id));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM customers WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM opportunities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type IN ('lead','opportunity') AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
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
