import { env } from "../config/env";

async function main() {
  const res = await fetch(`${env.FRAPPE_BASE_URL}/api/resource/Webhook/New Reply Sync`, {
    headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` },
  });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
