// TEMPORARY local-only seed - the first quotes/tickets seed reused whatever
// Qualified/Converted leads existed, which turned out to be exclusively
// other automated tests' own fixture leads ("P3Cfix Conversion Test Lead
// A/B" etc.) - fine for their purpose, but ugly/confusing to look at while
// visually verifying UI. This walks REAL, already-imported leads (the ones
// with normal-looking names, same ones visible in the Call Center queue)
// through the actual pipeline using the real service functions, so Quotes/
// Support Tickets get realistic-looking fixtures instead. Delete after
// verification, same as the other seedLocalDemoData* scripts.
import { pool } from "../config/db";
import { startFlc, escalateToSlc, qualifyLead, sendToField } from "../services/lead-call-center-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";
import { createQuote } from "../services/quote-service";

const TESTADMIN_ID = "0c51c72e-1da5-4b17-8d0d-3ab11a321eea";
const BAD_NAME = /test|p3cfix|fallback|reassign|recycle|serviceable|match|handoff|pincode|globaltest|dualteam|slconly|consent|skia|ccverify|happy|fixture|demo|conversion/i;

async function getLeadState(leadId: string) {
  const r = await pool.query<{ status: string; owner_id: string }>("SELECT status, owner_id FROM leads WHERE id = $1", [leadId]);
  return r.rows[0];
}

async function walkToOpportunity(leadId: string): Promise<string | null> {
  try {
    let state = await getLeadState(leadId);
    if (state.status === "New") {
      await startFlc(leadId, state.owner_id);
      state = await getLeadState(leadId);
    }
    if (state.status === "FLC") {
      await escalateToSlc(leadId, state.owner_id);
      state = await getLeadState(leadId);
    }
    if (state.status === "SLC") {
      await qualifyLead(leadId, state.owner_id);
      state = await getLeadState(leadId);
    }
    if (state.status !== "Qualified") return null;

    const ownerRoleResult = await pool.query<{ role: string }>("SELECT role FROM users WHERE id = $1", [state.owner_id]);
    if (ownerRoleResult.rows[0]?.role !== "agent") {
      await sendToField(leadId, state.owner_id, undefined);
      state = await getLeadState(leadId);
    }

    const opp = await convertLeadToOpportunity(leadId, {}, state.owner_id);
    return opp.id;
  } catch (e) {
    console.error(`Lead ${leadId} failed to walk to opportunity:`, (e as Error).message);
    return null;
  }
}

async function main() {
  const candidates = await pool.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM leads WHERE is_deleted = false AND status IN ('New','FLC','SLC','Qualified') ORDER BY lead_number LIMIT 400`
  );
  const clean = candidates.rows.filter((r) => !BAD_NAME.test(r.full_name) && !r.full_name.includes("?") && r.full_name.trim().length > 0);
  console.log(`Found ${clean.length} clean-named candidate leads`);

  const pairs: { leadId: string; oppId: string }[] = [];
  for (const lead of clean) {
    if (pairs.length >= 25) break;
    const oppId = await walkToOpportunity(lead.id);
    if (oppId) pairs.push({ leadId: lead.id, oppId });
  }
  console.log(`Walked ${pairs.length} leads to a real Opportunity`);

  let quoteCount = 0;
  for (let i = 0; i < pairs.length; i++) {
    try {
      await createQuote(
        {
          leadId: pairs[i].leadId,
          opportunityId: pairs[i].oppId,
          lineItems: [
            { description: "Franchise setup kit", quantity: 1, unitPrice: 45000 + i * 1000, taxPercent: 18 },
            { description: "Installation & training", quantity: 1, unitPrice: 8000, taxPercent: 18 },
          ],
        },
        TESTADMIN_ID
      );
      quoteCount++;
    } catch (e) {
      console.error(`Quote ${i + 1} failed:`, (e as Error).message);
    }
  }

  const TICKET_STATUSES = ["Open", "Replied", "Resolved", "Closed"];
  const TICKET_PRIORITIES = ["Urgent", "High", "Medium", "Low"];
  const TICKET_SUBJECTS = [
    "Delivery delayed for store setup",
    "Invoice mismatch on last order",
    "Franchise signage not yet installed",
    "POS terminal not syncing",
    "Need replacement for damaged stock",
    "Query about renewal terms",
    "Store opening checklist clarification",
    "Billing portal access issue",
  ];
  let ticketCount = 0;
  for (let i = 0; i < pairs.length; i++) {
    const status = TICKET_STATUSES[i % TICKET_STATUSES.length];
    const priority = TICKET_PRIORITIES[i % TICKET_PRIORITIES.length];
    const subject = TICKET_SUBJECTS[i % TICKET_SUBJECTS.length];
    try {
      await pool.query(
        `INSERT INTO support_tickets (lead_id, subject, description, status, priority, frappe_ticket_name, created_by)
         VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
        [pairs[i].leadId, subject, "Demo seed ticket for local pagination testing.", status, priority, TESTADMIN_ID]
      );
      ticketCount++;
    } catch (e) {
      console.error(`Ticket ${i + 1} failed:`, (e as Error).message);
    }
  }

  console.log(`Seeded ${quoteCount} quotes and ${ticketCount} support tickets using clean leads`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
