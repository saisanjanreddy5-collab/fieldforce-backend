import { pool } from "../config/db";
import { createAddressSchema } from "../validators/customer-address-validator";
import { createLead } from "../services/lead-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";
import { createAddress } from "../services/customer-address-service";

// Customer Address's pincode field previously had zero format validation
// (just a max-length string) - unlike Lead/FOFO's pincode, which already
// requires a real 6-digit value. Same reasoning as lead-validator.ts's own
// pincode field: blank is fine, but a non-blank value must be 6 digits.

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
    assertTrue(
      "Pincode rejects letters",
      !createAddressSchema.safeParse({ type: "billing", addressLine1: "X", pincode: "ABC123" }).success
    );
    assertTrue(
      "Pincode rejects 5 digits",
      !createAddressSchema.safeParse({ type: "billing", addressLine1: "X", pincode: "56000" }).success
    );
    assertTrue(
      "Pincode rejects 7 digits",
      !createAddressSchema.safeParse({ type: "billing", addressLine1: "X", pincode: "5600011" }).success
    );
    assertTrue(
      "Pincode accepts a real 6-digit value",
      createAddressSchema.safeParse({ type: "billing", addressLine1: "X", pincode: "560001" }).success
    );
    assertTrue(
      "Pincode still optional (blank is fine)",
      createAddressSchema.safeParse({ type: "billing", addressLine1: "X", pincode: "" }).success
    );
    assertTrue(
      "Pincode still trims surrounding whitespace before checking",
      createAddressSchema.safeParse({ type: "billing", addressLine1: "X", pincode: "  560001  " }).success
    );

    // --- Real end-to-end round-trip through the actual service, not just the schema ---
    const lead = await createLead({ fullName: "Customer Address Pincode Round-Trip Test" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    // Opportunity creation now requires the lead to have reached Qualified -
    // this test is about Customer Address pincode validation, not the Call
    // Center pipeline.
    await pool.query("UPDATE leads SET status = 'Qualified' WHERE id = $1", [lead.id]);
    await convertLeadToOpportunity(lead.id, {}, testadminId);

    const customerResult = await pool.query<{ id: string }>("SELECT id FROM customers WHERE lead_id = $1", [lead.id]);
    const customerId = customerResult.rows[0].id;

    const parsedInput = createAddressSchema.parse({
      type: "billing",
      addressLine1: "123 Test Street",
      pincode: "560001",
    });
    const address = await createAddress(customerId, parsedInput, testadminId);
    assertEqual("Pincode round-trips unchanged through the real service", address.pincode, "560001");

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query(
        "DELETE FROM customer_addresses WHERE customer_id IN (SELECT id FROM customers WHERE lead_id = ANY($1::uuid[]))",
        [createdLeadIds]
      );
      await pool.query("DELETE FROM customers WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM opportunities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type IN ('lead','opportunity') AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
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
