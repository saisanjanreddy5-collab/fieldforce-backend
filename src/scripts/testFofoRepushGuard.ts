import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { pushToOnboardingApp } from "../services/fofo-onboarding-service";

// Covers the client-confirmed fix: a specific lead must never be pushed to
// the onboarding app twice (that's what threw the confusing "already
// registered" error, after a full approval chain, with zero earlier
// warning) - but a DIFFERENT lead sharing the same phone number (the same
// person legitimately owning several franchises) must never be blocked by
// this. The guard only ever checks THIS lead's own push_status, never a
// cross-lead phone lookup, by design.
//
// Deliberately never calls pushToOnboardingApp on a lead that could reach
// the real external SKIA FOFO registration call - that integration is
// genuinely configured in this environment, and this script must never
// place a real request against it. Leads here are seeded with push_status
// already set directly in SQL, so the guard throws and returns before
// skia-fofo-service.ts is ever reached.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    const sharedPhone = "9876500081";

    // Lead A: already pushed (seeded directly, never via the real flow).
    const leadA = await createLead({ fullName: "Repush Guard Test - Store A", phone: sharedPhone }, testadminId, undefined, {});
    createdLeadIds.push(leadA.id);
    await pool.query(
      "UPDATE leads SET push_status = 'pushed', onboarding_app_id = 'FOFO-TESTAAAA', pushed_at = now() WHERE id = $1",
      [leadA.id]
    );

    let threwExpected = false;
    let errorMessage = "";
    try {
      await pushToOnboardingApp(leadA.id, testadminId, "admin");
    } catch (err) {
      threwExpected = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    assertTrue("Re-pushing an already-pushed lead is rejected", threwExpected);
    assertTrue("Rejection message clearly explains it was already pushed", errorMessage.toLowerCase().includes("already"));

    // Lead B: a SEPARATE lead, same phone number (the same owner's second
    // franchise) - confirm the guard does NOT fire for this one. A pending
    // approval step is seeded so the function stops at the next real check
    // ("all approval steps must be approved") instead of ever reaching the
    // real external SKIA FOFO call - .some() on an empty steps array would
    // otherwise be vacuously false and let it fall all the way through.
    const leadB = await createLead({ fullName: "Repush Guard Test - Store B", phone: sharedPhone }, testadminId, undefined, {});
    createdLeadIds.push(leadB.id);
    await pool.query(
      "INSERT INTO lead_approval_steps (lead_id, step_order, role_label, status) VALUES ($1, 1, 'Reporting manager approval', 'pending')",
      [leadB.id]
    );

    let leadBError = "";
    try {
      await pushToOnboardingApp(leadB.id, testadminId, "admin");
    } catch (err) {
      leadBError = err instanceof Error ? err.message : String(err);
    }
    assertTrue(
      "A different lead with the SAME phone number is NOT blocked by the re-push guard (same owner, second franchise is fine)",
      !leadBError.toLowerCase().includes("already pushed")
    );
    assertTrue(
      "...confirmed by stopping at the next real check instead (approval pending), never reaching the external call",
      leadBError.toLowerCase().includes("approved before pushing")
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM lead_approval_steps WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM leads WHERE id = ANY($1::uuid[])", [createdLeadIds]);
    }
  }

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
