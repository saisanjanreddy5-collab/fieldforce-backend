import { pool } from "../config/db";
import { createLeadSchema } from "../validators/lead-validator";
import { createLead, getLeadById } from "../services/lead-service";

// Covers the QA bug sheet's WEB-001 (pincode half)/WEB-003/WEB-012/WEB-016:
// pincode, GST number and Aadhaar number previously had zero format
// validation anywhere (backend or frontend) - garbage text would save
// silently. Mostly pure schema checks (no DB needed) plus one real
// create+read round-trip to prove a valid value still saves/reads
// correctly end to end, not just that the schema shape is right.

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
    // --- Pincode: must be blank or a real 6-digit number ---
    assertTrue("Pincode rejects letters", !createLeadSchema.safeParse({ fullName: "X", pincode: "ABC123" }).success);
    assertTrue("Pincode rejects 5 digits", !createLeadSchema.safeParse({ fullName: "X", pincode: "56000" }).success);
    assertTrue("Pincode rejects 7 digits", !createLeadSchema.safeParse({ fullName: "X", pincode: "5600011" }).success);
    assertTrue("Pincode accepts a real 6-digit value", createLeadSchema.safeParse({ fullName: "X", pincode: "560001" }).success);
    assertTrue("Pincode still optional (blank is fine)", createLeadSchema.safeParse({ fullName: "X", pincode: "" }).success);
    assertTrue(
      "Pincode still trims surrounding whitespace before checking",
      createLeadSchema.safeParse({ fullName: "X", pincode: "  560001  " }).success
    );

    // --- GST number: must be blank or a real 15-char GSTIN ---
    assertTrue(
      "GSTIN rejects plain digits (wrong shape)",
      !createLeadSchema.safeParse({ fullName: "X", gstNumber: "123456789012345" }).success
    );
    assertTrue(
      "GSTIN rejects a value missing the 14th-position 'Z'",
      !createLeadSchema.safeParse({ fullName: "X", gstNumber: "22AAAAA0000A1X5" }).success
    );
    assertTrue(
      "GSTIN accepts a real-shaped value and uppercases it",
      createLeadSchema.safeParse({ fullName: "X", gstNumber: "22aaaaa0000a1z5" }).success &&
        createLeadSchema.parse({ fullName: "X", gstNumber: "22aaaaa0000a1z5" }).gstNumber === "22AAAAA0000A1Z5"
    );
    assertTrue("GST number still optional (blank is fine)", createLeadSchema.safeParse({ fullName: "X", gstNumber: "" }).success);

    // --- Aadhaar number: must be blank or a real 12-digit number starting 2-9 ---
    assertTrue(
      "Aadhaar rejects 11 digits",
      !createLeadSchema.safeParse({ fullName: "X", aadhaarNumber: "23456789012" }).success
    );
    assertTrue(
      "Aadhaar rejects a number starting with 0 or 1 (UIDAI never issues these)",
      !createLeadSchema.safeParse({ fullName: "X", aadhaarNumber: "123456789012" }).success
    );
    assertTrue(
      "Aadhaar accepts a real-shaped 12-digit value",
      createLeadSchema.safeParse({ fullName: "X", aadhaarNumber: "234567890123" }).success
    );
    assertTrue(
      "Aadhaar number still optional (blank is fine)",
      createLeadSchema.safeParse({ fullName: "X", aadhaarNumber: "" }).success
    );

    // --- Real end-to-end round-trip: valid values still save/read correctly ---
    // Parsed through createLeadSchema first, same as the real request path -
    // validateBody's middleware (not createLead itself) is what applies the
    // uppercase transform, so calling createLead directly with a lowercase
    // value (skipping that middleware) would never uppercase it.
    const parsedInput = createLeadSchema.parse({
      fullName: "Pincode GST Aadhaar Round-Trip Test",
      pincode: "560001",
      gstNumber: "22aaaaa0000a1z5",
      aadhaarNumber: "234567890123",
    });
    const lead = await createLead(parsedInput, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    const fetched = await getLeadById(lead.id, testadminId);
    assertEqual("Pincode round-trips unchanged", fetched.pincode, "560001");
    assertEqual("GST number round-trips uppercased", fetched.gstNumber, "22AAAAA0000A1Z5");
    assertEqual("Aadhaar number round-trips unchanged", fetched.aadhaarNumber, "234567890123");

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
