import { pool } from "../config/db";
import { createLead, getLeadTimeline } from "../services/lead-service";
import { createQuote, updateQuote, updateQuoteStatus } from "../services/quote-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";

// Covers "Quote creation/editing never showed up in the Lead's History" -
// quote-service.ts had zero recordAuditEvent calls at all. Fixed by logging
// against the lead (quotes have no History tab of their own, unlike
// Opportunities), so creating, revising, and changing a quote's status all
// now appear in getLeadTimeline alongside every other thing that happened
// to this lead.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;
  const fieldAgent = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'agent' AND is_active = true LIMIT 1");

  const createdLeadIds: string[] = [];

  try {
    const lead = await createLead({ fullName: "Quote History Test Lead" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    await pool.query("UPDATE leads SET status = 'Qualified', owner_id = $1 WHERE id = $2", [fieldAgent.rows[0].id, lead.id]);
    const opp = await convertLeadToOpportunity(lead.id, { name: "Quote History Test Opp" }, testadminId);

    const { quote } = await createQuote(
      { leadId: lead.id, opportunityId: opp.id, lineItems: [{ description: "Item A", quantity: 1, unitPrice: 1000, taxPercent: 18 }] },
      testadminId
    );

    const timelineAfterCreate = await getLeadTimeline(lead.id, testadminId);
    const createdEvent = timelineAfterCreate.find((e) => e.kind === "audit" && e.event?.action === "quote_created");
    assertTrue("Lead timeline includes the quote_created event", Boolean(createdEvent));
    assertTrue("quote_created summary names the real actor", Boolean(createdEvent?.event?.summary.includes("Test Admin")));

    await updateQuote(
      quote.id,
      { lineItems: [{ description: "Item A", quantity: 2, unitPrice: 1000, taxPercent: 18 }], changeSummary: "Doubled quantity" },
      testadminId
    );
    const timelineAfterRevise = await getLeadTimeline(lead.id, testadminId);
    const revisedEvent = timelineAfterRevise.find((e) => e.kind === "audit" && e.event?.action === "quote_revised");
    assertTrue("Lead timeline includes the quote_revised event", Boolean(revisedEvent));
    assertTrue("quote_revised summary includes the change summary", Boolean(revisedEvent?.event?.summary.includes("Doubled quantity")));
    assertTrue("quote_revised oldValue/newValue show the version bump", revisedEvent?.event?.oldValue === "v1" && revisedEvent?.event?.newValue === "v2");

    await updateQuoteStatus(quote.id, "sent", testadminId);
    const timelineAfterStatus = await getLeadTimeline(lead.id, testadminId);
    const statusEvent = timelineAfterStatus.find((e) => e.kind === "audit" && e.event?.action === "quote_status_changed");
    assertTrue("Lead timeline includes the quote_status_changed event", Boolean(statusEvent));
    assertTrue("quote_status_changed shows draft -> sent", statusEvent?.event?.oldValue === "draft" && statusEvent?.event?.newValue === "sent");

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM quote_versions WHERE quote_id IN (SELECT id FROM quotes WHERE lead_id = ANY($1::uuid[]))", [createdLeadIds]);
      await pool.query("DELETE FROM quotes WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM opportunities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM customers WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
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
