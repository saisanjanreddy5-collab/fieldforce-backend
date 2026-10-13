import { env } from "../config/env";

async function main() {
  const res = await fetch(
    `${env.FRAPPE_BASE_URL}/api/resource/Communication?filters=${encodeURIComponent(
      JSON.stringify([["reference_name", "=", "0004"]])
    )}&fields=${encodeURIComponent(JSON.stringify(["name", "subject", "sent_or_received", "reference_doctype", "content", "creation"]))}&order_by=creation desc`,
    { headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` } }
  );
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
