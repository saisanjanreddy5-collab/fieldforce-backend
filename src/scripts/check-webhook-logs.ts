import { env } from "../config/env";

async function main() {
  // Check if Webhook Request Log doctype exists and has recent entries
  const res = await fetch(
    `${env.FRAPPE_BASE_URL}/api/resource/Webhook Request Log?fields=${encodeURIComponent(
      JSON.stringify(["name", "webhook", "url", "response", "error", "creation"])
    )}&order_by=creation desc&limit_page_length=10`,
    { headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` } }
  );
  const body = await res.json();
  console.log("Webhook Request Log:", JSON.stringify(body, null, 2));

  // Also list configured Webhooks to confirm the new-reply one exists and its condition
  const res2 = await fetch(
    `${env.FRAPPE_BASE_URL}/api/resource/Webhook?fields=${encodeURIComponent(
      JSON.stringify(["name", "webhook_doctype", "webhook_docevent", "condition", "request_url", "enabled"])
    )}`,
    { headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` } }
  );
  const body2 = await res2.json();
  console.log("\nConfigured Webhooks:", JSON.stringify(body2, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
