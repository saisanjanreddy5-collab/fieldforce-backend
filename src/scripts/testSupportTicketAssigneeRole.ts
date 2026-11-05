import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { assignTicket } from "../services/support-ticket-service";

// Covers the client-reported gap: the assignee picker offered every active
// user, including Call Center accounts - but Call Center has no
// support_tickets.view at all, so a ticket assigned to one would be
// invisible to them forever. Fixed in support-ticket-service.ts's
// assignTicket (backend) and SupportTicketDetailDrawer.tsx (frontend list).

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;

  const createdLeadIds: string[] = [];
  let ticketId: string | null = null;

  try {
    const lead = await createLead({ fullName: "Assignee Role Guard Test" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    await pool.query("UPDATE leads SET status = 'Qualified' WHERE id = $1", [lead.id]);

    const ticketResult = await pool.query<{ id: string }>(
      `INSERT INTO support_tickets (lead_id, subject, status, priority, created_by)
       VALUES ($1, 'Assignee role guard test ticket', 'Open', 'Medium', $2) RETURNING id`,
      [lead.id, testadminId]
    );
    ticketId = ticketResult.rows[0].id;

    let ccError = "";
    try {
      await assignTicket(ticketId, cc1Id, testadminId);
    } catch (err) {
      ccError = err instanceof Error ? err.message : String(err);
    }
    assertTrue("Assigning a ticket to a Call Center user is rejected", ccError.toLowerCase().includes("call center"));

    const assigned = await assignTicket(ticketId, testadminId, testadminId);
    assertTrue("Assigning to a non-Call-Center user (Admin) still works", assigned.assignedTo === testadminId);

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (ticketId) {
      await pool.query("DELETE FROM support_ticket_messages WHERE ticket_id = $1", [ticketId]);
      await pool.query("DELETE FROM support_tickets WHERE id = $1", [ticketId]);
    }
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
