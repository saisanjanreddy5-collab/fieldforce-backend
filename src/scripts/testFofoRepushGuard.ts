import { pool } from "../config/db";
import { env } from "../config/env";
import { createLead } from "../services/lead-service";
import { pushToOnboardingApp } from "../services/fofo-onboarding-service";

// Covers the client-confirmed fix: a specific lead must never be pushed to
// the onboarding app twice (that's what threw the confusing "already
// registered" error, with zero earlier warning) - but a DIFFERENT lead sharing the same phone number (the same
// person legitimately owning several franchises) must never be blocked by
// this. The guard only ever checks THIS lead's own push_status, never a
// cross-lead phone lookup, by design.
//
// Deliberately never calls pushToOnboardingApp on a lead that could reach
// the real external SKIA FOFO registration call - that integration is
// genuinely configured in this environment, and this script must never
// place a real request against it. Lead A is seeded with push_status
// already set directly in SQL, so the guard throws before skia-fofo-service.ts
// is ever reached; for lead B the SKIA token is blanked in-process first, so
// registration stops at "not configured" before any network call.

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
    // Converted, as a pushed lead is - only then may the same number open a
    // second lead (one active lead per mobile number).
    const leadA = await createLead({ fullName: "Repush Guard Test - Store A", phone: sharedPhone }, testadminId, undefined, {});
    createdLeadIds.push(leadA.id);
    await pool.query(
      "UPDATE leads SET status = 'Converted', push_status = 'pushed', onboarding_app_id = 'FOFO-TESTAAAA', pushed_at = now() WHERE id = $1",
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
    // franchise) - confirm the guard does NOT fire for this one. The SKIA
    // token is blanked in-process so the push stops inside registerFofoUser
    // ("not configured") instead of ever reaching the real external call.
    const leadB = await createLead({ fullName: "Repush Guard Test - Store B", phone: sharedPhone }, testadminId, undefined, {});
    createdLeadIds.push(leadB.id);

    let leadBError = "";
    const realToken = env.SKIA_FOFO_CMR_TOKEN;
    env.SKIA_FOFO_CMR_TOKEN = undefined;
    try {
      await pushToOnboardingApp(leadB.id, testadminId, "admin");
    } catch (err) {
      leadBError = err instanceof Error ? err.message : String(err);
    } finally {
      env.SKIA_FOFO_CMR_TOKEN = realToken;
    }
    assertTrue(
      "A different lead with the SAME phone number is NOT blocked by the re-push guard (same owner, second franchise is fine)",
      !leadBError.toLowerCase().includes("already pushed")
    );
    assertTrue(
      "...confirmed by going straight on to SKIA registration (no approval needed), stopped there before any external call",
      leadBError.toLowerCase().includes("not configured")
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
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
