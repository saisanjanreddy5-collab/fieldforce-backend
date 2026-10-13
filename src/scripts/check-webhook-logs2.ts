import { env } from "../config/env";

async function main() {
  const res = await fetch(
    `${env.FRAPPE_BASE_URL}/api/resource/Webhook Request Log?fields=${encodeURIComponent(
      JSON.stringify(["name", "webhook", "url", "response", "error", "creation"])
    )}&order_by=creation desc&limit_page_length=3`,
    { headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` } }
  );
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
