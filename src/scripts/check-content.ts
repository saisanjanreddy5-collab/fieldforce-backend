import { env } from "../config/env";

async function main() {
  for (const name of ["0ej02edii9", "0eko10u0m9"]) {
    const res = await fetch(`${env.FRAPPE_BASE_URL}/api/resource/Communication/${name}?fields=${encodeURIComponent(JSON.stringify(["name", "content", "communication_date"]))}`, {
      headers: { Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}` },
    });
    const body = await res.json() as any;
    console.log(name, "| date:", body.data?.communication_date, "| content snippet:", body.data?.content?.match(/<div dir="ltr">([^<]*)/)?.[1] ?? body.data?.content?.slice(0, 200));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
