import { pool } from "../config/db";
import { createLeadSchema } from "../validators/lead-validator";
import { registerSchema } from "../validators/auth-validator";
import { updateUserSchema } from "../validators/user-validator";
import { convertLeadSchema, updateOpportunitySchema } from "../validators/opportunity-validator";
import { createTeamsMeetingSchema } from "../validators/microsoft-validator";
import { createLead, getLeadById } from "../services/lead-service";

// Covers the "testing team bug sheet" Batch 1 fixes: mobile number
// validation (Lead + Create User), Carpet Area/Frontage/Payment Days now
// real numbers (Nearest COCO Store/Margin Slab stay free text but reject an
// embedded negative), Expected Close Date past-date block (create only, not
// on later edits - see opportunity-validator.ts's own comment on why),
// Teams Meeting start-time past-date block. Mostly pure schema checks (no
// DB needed) plus one real create+read round-trip to prove the new
// carpet_area_sqft/frontage_ft/payment_days columns actually work end to
// end, not just that the schema shape is right.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    // --- Lead phone / altPhone: must be blank or a real 10-digit number ---
    assertTrue(
      "Lead phone rejects a too-short number",
      !createLeadSchema.safeParse({ fullName: "X", phone: "12345" }).success
    );
    assertTrue(
      "Lead phone rejects letters",
      !createLeadSchema.safeParse({ fullName: "X", phone: "abcdefghij" }).success
    );
    assertTrue(
      "Lead phone accepts a real 10-digit number",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210" }).success
    );
    assertTrue(
      // Superseded by a later fix in this same engagement: phone is now
      // mandatory on lead creation (was "blank is fine" when this test was
      // first written) - updated here instead of left stale/failing.
      "Lead phone is now mandatory - blank is rejected",
      !createLeadSchema.safeParse({ fullName: "X", phone: "" }).success
    );

    // --- Carpet area / Frontage: now real numbers, reject negative ---
    // (phone included on every case below purely to satisfy the now-required
    // field and isolate the actual thing each assertion is testing)
    assertTrue(
      "Carpet area rejects a negative number",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", carpetArea: -50 }).success
    );
    assertTrue(
      "Carpet area accepts a real positive number",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", carpetArea: 620 }).success
    );
    assertTrue(
      "Frontage rejects a negative number",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", frontage: -5 }).success
    );

    // --- Payment days: now a real non-negative integer ---
    assertTrue(
      "Payment days rejects a negative number",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", paymentTerms: -21 }).success
    );
    assertTrue(
      "Payment days accepts a real positive integer",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", paymentTerms: 21 }).success
    );

    // --- Nearest COCO store / Margin slab: stay free text, just can't embed a negative number ---
    assertTrue(
      "Nearest COCO store rejects an embedded negative number",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", nearestCocoStore: "Baner - -6.2 km" }).success
    );
    assertTrue(
      "Nearest COCO store still accepts its normal free-text shape",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", nearestCocoStore: "Baner - 6.2 km" }).success
    );
    assertTrue(
      "Margin slab rejects an embedded negative number",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", marginSlab: "Slab B — -22%" }).success
    );
    assertTrue(
      "Margin slab still accepts its normal free-text shape",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", marginSlab: "Slab B — 22%" }).success
    );

    // --- User mobile number (Create User + Update User) ---
    assertTrue(
      "Register rejects a mobile number that's too long (the old VARCHAR(20) overflow crash)",
      !registerSchema.safeParse({ name: "X", email: "x@test.local", password: "Password123", role: "agent", mobile: "1".repeat(30) }).success
    );
    assertTrue(
      "Register accepts a plain 10-digit mobile",
      registerSchema.safeParse({ name: "X", email: "x@test.local", password: "Password123", role: "agent", mobile: "9876543210" }).success
    );
    assertTrue(
      "Register accepts a +91-prefixed mobile",
      registerSchema.safeParse({ name: "X", email: "x@test.local", password: "Password123", role: "agent", mobile: "+91 9876543210" }).success
    );
    assertTrue(
      "Update user rejects garbage mobile text",
      !updateUserSchema.safeParse({ mobile: "call me maybe" }).success
    );

    // --- Opportunity Expected Close Date: blocked on conversion, NOT on later edits ---
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assertTrue(
      "convertLeadSchema rejects a past close date",
      !convertLeadSchema.safeParse({ closeDate: yesterday }).success
    );
    assertTrue(
      "convertLeadSchema accepts a future close date",
      convertLeadSchema.safeParse({ closeDate: tomorrow }).success
    );
    assertTrue(
      "updateOpportunitySchema allows a past close date (deals slip - must never block an unrelated edit)",
      updateOpportunitySchema.safeParse({ closeDate: yesterday, notes: "still chasing this" }).success
    );

    // --- Teams meeting start time: must not be in the past ---
    const pastIso = new Date(Date.now() - 3600000).toISOString();
    const futureIso = new Date(Date.now() + 3600000).toISOString();
    assertTrue(
      "Teams meeting rejects a past start time",
      !createTeamsMeetingSchema.safeParse({ subject: "Call", startTime: pastIso, endTime: futureIso }).success
    );
    assertTrue(
      "Teams meeting accepts a future start time",
      createTeamsMeetingSchema.safeParse({ subject: "Call", startTime: futureIso, endTime: futureIso }).success
    );

    // --- Real end-to-end round-trip: new numeric columns actually work ---
    const lead = await createLead(
      { fullName: "Batch1 Validation Round-Trip Test", carpetArea: 620, frontage: 18, paymentTerms: 21 },
      testadminId,
      undefined,
      {}
    );
    createdLeadIds.push(lead.id);
    const fetched = await getLeadById(lead.id, testadminId);
    assertEqual("Carpet area round-trips as a clean number", fetched.carpetArea, 620);
    assertEqual("Frontage round-trips as a clean number", fetched.frontage, 18);
    assertEqual("Payment days round-trips as a clean number", fetched.paymentTerms, 21);

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
