import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";
import { listContacts, createContact, deleteContact, restoreContact } from "../services/customer-contact-service";
import { listAddresses, createAddress, deleteAddress, restoreAddress } from "../services/customer-address-service";

// Covers the client-reported gap: Customer contacts and addresses already
// had a correct "Archive" button, but no way anywhere to see what got
// archived or bring it back. Fixed with an `archived` list flag (flips
// is_deleted = false -> true, never both mixed) plus a dedicated restore
// function for each, same shape as every other entity in this feature pack.

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
    const lead = await createLead({ fullName: "Customer Contact/Address Archive Test" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    await convertLeadToOpportunity(lead.id, {}, testadminId);

    const customerResult = await pool.query<{ id: string }>("SELECT id FROM customers WHERE lead_id = $1", [lead.id]);
    const customerId = customerResult.rows[0].id;

    // --- Contacts ---
    const contact = await createContact(customerId, { name: "Test Contact" }, testadminId);

    const activeContactsBefore = await listContacts(customerId, testadminId);
    assertTrue("Contact appears in the active list before archiving", activeContactsBefore.some((c) => c.id === contact.id));

    await deleteContact(contact.id, testadminId);

    const activeContactsAfter = await listContacts(customerId, testadminId);
    assertTrue("Contact no longer appears in the active list after archiving", !activeContactsAfter.some((c) => c.id === contact.id));

    const archivedContacts = await listContacts(customerId, testadminId, true);
    assertTrue("Contact appears in the archived list", archivedContacts.some((c) => c.id === contact.id));

    await restoreContact(contact.id, testadminId);

    const activeContactsRestored = await listContacts(customerId, testadminId);
    assertTrue("Contact is back in the active list after restoring", activeContactsRestored.some((c) => c.id === contact.id));

    const archivedContactsAfterRestore = await listContacts(customerId, testadminId, true);
    assertTrue("Contact no longer appears in the archived list after restoring", !archivedContactsAfterRestore.some((c) => c.id === contact.id));

    // --- Addresses ---
    const address = await createAddress(customerId, { type: "billing", addressLine1: "123 Test Street" }, testadminId);

    const activeAddressesBefore = await listAddresses(customerId, testadminId);
    assertTrue("Address appears in the active list before archiving", activeAddressesBefore.some((a) => a.id === address.id));

    await deleteAddress(address.id, testadminId);

    const activeAddressesAfter = await listAddresses(customerId, testadminId);
    assertTrue("Address no longer appears in the active list after archiving", !activeAddressesAfter.some((a) => a.id === address.id));

    const archivedAddresses = await listAddresses(customerId, testadminId, true);
    assertTrue("Address appears in the archived list", archivedAddresses.some((a) => a.id === address.id));

    await restoreAddress(address.id, testadminId);

    const activeAddressesRestored = await listAddresses(customerId, testadminId);
    assertTrue("Address is back in the active list after restoring", activeAddressesRestored.some((a) => a.id === address.id));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query(
        "DELETE FROM customer_contacts WHERE customer_id IN (SELECT id FROM customers WHERE lead_id = ANY($1::uuid[]))",
        [createdLeadIds]
      );
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
