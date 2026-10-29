import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { qualifyLead, escalateToSlc } from "../services/lead-call-center-service";
import { ApiError } from "../utils/ApiError";

// Verifies the client's "remove TLC" revision actually took effect end to
// end: a lead created today lands at FLC, can't be Qualified before SLC,
// escalates FLC -> SLC via the existing real service call, and only then can
// be marked Qualified - with no TLC stage anywhere in the path any more.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${expected}, got ${actual})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const creatorId = cc1.rows[0].id;

  const lead = await createLead(
    { fullName: "TLC Removal Test Lead", phone: "9876500011" },
    creatorId,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );
  console.log("Lead created:", lead.id, "status:", lead.status);
  assertEqual("New lead lands at FLC", lead.status, "FLC");

  let rejectedAtFlc = false;
  let rejectionMessage = "";
  try {
    await qualifyLead(lead.id, creatorId);
  } catch (err) {
    rejectedAtFlc = err instanceof ApiError && err.statusCode === 422;
    rejectionMessage = err instanceof ApiError ? err.message : "";
  }
  assertEqual("Qualify from FLC is rejected", rejectedAtFlc, true);
  assertEqual("Rejection message names SLC (not TLC)", rejectionMessage.includes("SLC"), true);
  assertEqual("Rejection message does not mention TLC", rejectionMessage.includes("TLC"), false);

  const afterEscalate = await escalateToSlc(lead.id, creatorId);
  assertEqual("escalateToSlc moves lead to SLC", afterEscalate.status, "SLC");

  const cc2 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc2@test.local'");
  const slcOwnerId = cc2.rows[0].id;
  const afterQualify = await qualifyLead(lead.id, slcOwnerId);
  assertEqual("Qualify from SLC succeeds", afterQualify.status, "Qualified");

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  // Was leads-only, leaving every run's own escalated/status_changed audit
  // rows (and any activities) permanently orphaned in the database - not
  // just test debris, but rows a real admin-facing report (Call Center/
  // Field Sales performance, both of which aggregate audit_log by actor_id
  // and date) would silently pick up as if they were genuine activity.
  await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = $1", [lead.id]);
  await pool.query("DELETE FROM activities WHERE lead_id = $1", [lead.id]);
  await pool.query("DELETE FROM leads WHERE id = $1", [lead.id]);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
