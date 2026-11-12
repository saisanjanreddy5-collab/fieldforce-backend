// TEMPORARY local-only repair - two of the 25 "clean" leads picked for the
// Quotes/Support Tickets seed ("$harma", "!Deven Jain") turned out to have
// a garbled leading character already in the real imported data (a data-
// entry/import artifact, not something this seed created) - the earlier
// clean-name filter excluded '?' but not other odd leading punctuation.
// Swaps those two out for two fresh, properly-clean leads walked through
// the same real pipeline, and gives every seeded opportunity a less
// template-identical name while here. Delete after verification.
import { pool } from "../config/db";
import { startFlc, escalateToSlc, qualifyLead, sendToField } from "../services/lead-call-center-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";
import { createQuote } from "../services/quote-service";

const TESTADMIN_ID = "0c51c72e-1da5-4b17-8d0d-3ab11a321eea";
const BAD_NAME = /test|p3cfix|fallback|reassign|recycle|serviceable|match|handoff|pincode|globaltest|dualteam|slconly|consent|skia|ccverify|happy|fixture|demo|conversion/i;
const DEAL_SUFFIXES = ["Franchise Deal", "New Store Deal", "Expansion Deal", "Outlet Setup", "Store Rollout"];

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
  // 1. Diversify every seeded opportunity's name so the list doesn't read
  // as one template repeated 25 times.
  const opps = await pool.query<{ id: string; full_name: string }>(
    `SELECT o.id, l.full_name FROM opportunities o JOIN leads l ON l.id = o.lead_id WHERE o.name LIKE '%Franchise Deal'`
  );
  for (let i = 0; i < opps.rows.length; i++) {
    const suffix = DEAL_SUFFIXES[i % DEAL_SUFFIXES.length];
    await pool.query("UPDATE opportunities SET name = $1 WHERE id = $2", [`${opps.rows[i].full_name} - ${suffix}`, opps.rows[i].id]);
  }
  console.log(`Diversified ${opps.rows.length} opportunity names`);

  // 2. Find the two garbled-name leads currently used by a seeded quote.
  const bad = await pool.query<{ lead_id: string; quote_id: string; full_name: string }>(
    `SELECT q.lead_id, q.id as quote_id, l.full_name
     FROM quotes q JOIN leads l ON l.id = q.lead_id
     WHERE l.full_name !~ '^[A-Za-z]'`
  );
  console.log(`Found ${bad.rows.length} garbled-name leads to replace:`, bad.rows.map((r) => r.full_name));

  if (bad.rows.length === 0) {
    await pool.end();
    return;
  }

  // 3. Delete those quotes and their matching seeded tickets.
  for (const row of bad.rows) {
    await pool.query("DELETE FROM quote_versions WHERE quote_id = $1", [row.quote_id]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [row.quote_id]);
    await pool.query(
      `DELETE FROM support_tickets WHERE lead_id = $1 AND description = 'Demo seed ticket for local pagination testing.'`,
      [row.lead_id]
    );
  }
  console.log("Deleted the garbled-name quotes/tickets");

  // 4. Pick fresh, properly-clean replacement leads.
  const usedResult = await pool.query<{ id: string }>("SELECT lead_id as id FROM quotes JOIN leads ON leads.id = quotes.lead_id");
  const usedIds = new Set(usedResult.rows.map((r) => r.id));
  const candidates = await pool.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM leads WHERE is_deleted = false AND status IN ('New','FLC','SLC','Qualified') ORDER BY lead_number LIMIT 400`
  );
  const clean = candidates.rows.filter(
    (r) => !usedIds.has(r.id) && !BAD_NAME.test(r.full_name) && /^[A-Za-z]/.test(r.full_name.trim()) && r.full_name.trim().length > 0
  );

  const replacements: { leadId: string; oppId: string; fullName: string }[] = [];
  for (const lead of clean) {
    if (replacements.length >= bad.rows.length) break;
    const oppId = await walkToOpportunity(lead.id);
    if (oppId) replacements.push({ leadId: lead.id, oppId, fullName: lead.full_name });
  }
  console.log(`Walked ${replacements.length} replacement leads to a real Opportunity`);

  for (let i = 0; i < replacements.length; i++) {
    const r = replacements[i];
    await pool.query("UPDATE opportunities SET name = $1 WHERE id = $2", [`${r.fullName} - ${DEAL_SUFFIXES[i % DEAL_SUFFIXES.length]}`, r.oppId]);
    try {
      await createQuote(
        {
          leadId: r.leadId,
          opportunityId: r.oppId,
          lineItems: [
            { description: "Franchise setup kit", quantity: 1, unitPrice: 50000, taxPercent: 18 },
            { description: "Installation & training", quantity: 1, unitPrice: 8000, taxPercent: 18 },
          ],
        },
        TESTADMIN_ID
      );
    } catch (e) {
      console.error(`Replacement quote failed for ${r.fullName}:`, (e as Error).message);
    }
    try {
      await pool.query(
        `INSERT INTO support_tickets (lead_id, subject, description, status, priority, frappe_ticket_name, created_by)
         VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
        [r.leadId, "Query about renewal terms", "Demo seed ticket for local pagination testing.", "Open", "Medium", TESTADMIN_ID]
      );
    } catch (e) {
      console.error(`Replacement ticket failed for ${r.fullName}:`, (e as Error).message);
    }
  }

  console.log("Done");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
