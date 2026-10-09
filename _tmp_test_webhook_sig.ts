import { pool } from "./src/config/db";
import crypto from "crypto";

async function main() {
  // Disposable test ticket, no real Frappe site involved - just testing our own webhook receiver.
  const lead = await pool.query(
    `INSERT INTO leads (full_name, phone, status, owner_id, created_by)
     SELECT 'Webhook Test Lead', '9999999997', 'new', id, id FROM users LIMIT 1
     RETURNING id`
  );
  const leadId = lead.rows[0]?.id;
  if (!leadId) { console.log("No admin user found to own the test lead"); await pool.end(); return; }

  const ticket = await pool.query(
    `INSERT INTO support_tickets (lead_id, subject, status, frappe_ticket_name)
     VALUES ($1, 'Webhook sig test', 'Open', 'WEBHOOK-TEST-0001')
     RETURNING id`,
    [leadId]
  );
  console.log("Test ticket:", ticket.rows[0].id, "lead:", leadId);

  const secret = "26231186149aaf1535288b58282265c306703ac9fb239169e1b41eda937d1ef0";
  const payload = JSON.stringify({ ticket_name: "WEBHOOK-TEST-0001", status: "Resolved" });
  const validSig = crypto.createHmac("sha256", secret).update(payload).digest("base64");

  console.log("\n=== Valid signature ===");
  const res1 = await fetch("http://localhost:8000/api/integrations/frappe/webhook/ticket-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Frappe-Webhook-Signature": validSig },
    body: payload,
  });
  console.log("Status:", res1.status, await res1.text());

  console.log("\n=== Invalid signature ===");
  const res2 = await fetch("http://localhost:8000/api/integrations/frappe/webhook/ticket-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Frappe-Webhook-Signature": "wrong-signature-entirely" },
    body: payload,
  });
  console.log("Status:", res2.status, await res2.text());

  console.log("\n=== No signature at all ===");
  const res3 = await fetch("http://localhost:8000/api/integrations/frappe/webhook/ticket-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  console.log("Status:", res3.status, await res3.text());

  const check = await pool.query("SELECT status FROM support_tickets WHERE id = $1", [ticket.rows[0].id]);
  console.log("\nTicket status in DB after all 3 requests:", check.rows[0].status);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
