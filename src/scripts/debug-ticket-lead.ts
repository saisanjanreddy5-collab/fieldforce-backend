import { pool } from "../config/db";

async function main() {
  const r = await pool.query(
    `SELECT t.id as ticket_id, t.frappe_ticket_name, t.lead_id, l.full_name, l.is_deleted
     FROM support_tickets t JOIN leads l ON l.id = t.lead_id
     WHERE t.subject = 'Delayed delivery'`
  );
  console.log(r.rows);
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
