import { pool } from "../config/db";

async function main() {
  const ticket = await pool.query("SELECT id FROM support_tickets WHERE subject = 'Delayed delivery'");
  const messages = await pool.query(
    "SELECT direction, body, created_at FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at",
    [ticket.rows[0].id]
  );
  console.log("Messages on ticket #0004:", messages.rows);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
