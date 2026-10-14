import { env } from "../config/env";

async function main() {
  const res = await fetch(
    `${env.FRAPPE_BASE_URL}/api/resource/Communication?filters=${encodeURIComponent(
      JSON.stringify([["reference_name", "=", "0007"]])
    )}&fields=${encodeURIComponent(
      JSON.stringify(["name", "sent_or_received", "sender", "recipients", "subject", "in_reply_to", "creation", "communication_date"])
    )}&order_by=creation desc&limit_page_length=10`,
    { headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` } }
  );
  console.log("All Communications on ticket 0007:");
  console.log(await res.text());
}

main().catch((err) => { console.error(err); process.exit(1); });
