import { env } from "../config/env";

async function main() {
  const res = await fetch(`${env.FRAPPE_BASE_URL}/api/resource/Communication`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}`,
    },
    body: JSON.stringify({
      communication_type: "Communication",
      communication_medium: "Email",
      reference_doctype: "HD Ticket",
      reference_name: "0004",
      sent_or_received: "Received",
      subject: "Re: Delayed delivery",
      content: "Testing the fix.\nThis has a real newline in it,\nlike a genuine email would.",
    }),
  });
  const body = await res.json();
  console.log("Created test Communication:", JSON.stringify(body, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
