import fs from "fs";
import os from "os";
import path from "path";
import { pool } from "../config/db";
import { createLeadSchema, updateLeadSchema } from "../validators/lead-validator";
import { createLead } from "../services/lead-service";
import * as leadDocumentService from "../services/lead-document-service";

// Covers 3 of this round's fixes:
// - Phone Number is now mandatory on lead creation (was fully optional with
//   zero backend enforcement, even though the Call Center "Add lead" form's
//   own frontend already required it - a direct API call could bypass that).
// - Store tab's pincode field now has the same 6-digit check every other
//   pincode field in this app already has.
// - Consent evidence now has a real, generic (non-FOFO-gated) upload path
//   reusing the exact same lead_documents table/files FOFO onboarding uses.

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
  let tempFilePath: string | null = null;

  try {
    // --- Phone: mandatory on create; on edit, the Edit Lead drawer's own
    // frontend form requires it, but the backend schema stays partial so
    // other partial-save callers (e.g. FOFO onboarding's own step saves)
    // that never touch phone at all keep working - see updateLeadSchema's
    // own comment for the real incident this covers. ---
    assertTrue(
      "createLeadSchema rejects a lead with no phone at all",
      !createLeadSchema.safeParse({ fullName: "X" }).success
    );
    assertTrue(
      "createLeadSchema rejects a blank phone",
      !createLeadSchema.safeParse({ fullName: "X", phone: "" }).success
    );
    assertTrue(
      "createLeadSchema rejects a 9-digit phone",
      !createLeadSchema.safeParse({ fullName: "X", phone: "123456789" }).success
    );
    assertTrue(
      "createLeadSchema accepts a real 10-digit phone",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210" }).success
    );
    assertTrue(
      "updateLeadSchema (partial) still allows omitting phone entirely - other partial-save callers depend on this",
      updateLeadSchema.safeParse({ fullName: "Renamed, phone untouched" }).success
    );
    assertTrue(
      "updateLeadSchema still rejects an explicitly blank/invalid phone if one IS submitted",
      !updateLeadSchema.safeParse({ fullName: "Renamed", phone: "" }).success
    );
    assertTrue(
      "updateLeadSchema accepts the real FOFO onboarding 'Store information' step payload (no phone key at all - the actual reported incident)",
      updateLeadSchema.safeParse({
        hasStoreLocation: true,
        storeName: "zota store A",
        storeAddress: "testtt",
        storeCity: "mysore",
        storeState: "karnataka",
        storePincode: "571124",
        carpetArea: 400,
        frontage: 400,
        ownership: "Leased",
      }).success
    );
    assertTrue(
      "updateLeadSchema accepts a real phone when one is submitted",
      updateLeadSchema.safeParse({ fullName: "Renamed", phone: "9876543210" }).success
    );
    assertTrue(
      "altPhone is still fully optional (not affected by the phone fix)",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", altPhone: "" }).success
    );
    assertTrue(
      "email is still fully optional (not affected by the phone fix)",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210" }).success
    );

    // --- Store pincode: must be blank or a real 6-digit number ---
    assertTrue(
      "storePincode rejects letters",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", storePincode: "ABC123" }).success
    );
    assertTrue(
      "storePincode rejects 5 digits",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", storePincode: "56000" }).success
    );
    assertTrue(
      "storePincode accepts a real 6-digit value",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", storePincode: "560001" }).success
    );
    assertTrue(
      "storePincode still optional (blank is fine)",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", storePincode: "" }).success
    );

    // --- Real end-to-end round-trip: a valid lead (with the now-required phone) still creates fine ---
    const parsedInput = createLeadSchema.parse({
      fullName: "Phone/Pincode Fix Round-Trip Test",
      phone: "9876543210",
      storePincode: "560001",
    });
    const lead = await createLead(parsedInput, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    assertEqual("Phone round-trips unchanged", lead.phone, "9876543210");
    assertEqual("Store pincode round-trips unchanged", lead.storePincode, "560001");

    // --- Consent evidence: generic document service works for a plain lead ---
    const docs = await leadDocumentService.listDocuments(lead.id);
    assertTrue("All 6 document types exist for a plain lead (lazily created)", docs.length === 6);
    const consentDoc = docs.find((d) => d.docType === "consent_form");
    assertTrue("consent_form slot exists", consentDoc !== undefined);
    assertEqual("consent_form starts not_uploaded", consentDoc?.status, "not_uploaded");
    assertEqual("consent_form label is human-readable", consentDoc?.label, "Consent form");

    tempFilePath = path.join(os.tmpdir(), `consent-evidence-test-${Date.now()}.pdf`);
    fs.writeFileSync(tempFilePath, "fake pdf content for test");
    const fakeFile = {
      path: tempFilePath,
      originalname: "consent-proof.pdf",
    } as Express.Multer.File;

    const uploaded = await leadDocumentService.saveUploadedFile(lead.id, "consent_form", fakeFile, testadminId);
    assertEqual("Upload sets status to in_review", uploaded.status, "in_review");
    assertEqual("Upload records the real original filename", uploaded.originalFilename, "consent-proof.pdf");
    assertTrue("Upload marks hasFile true", uploaded.hasFile);

    const afterUpload = await leadDocumentService.listDocuments(lead.id);
    const consentAfter = afterUpload.find((d) => d.docType === "consent_form");
    assertEqual("Re-listing shows the uploaded file persisted", consentAfter?.originalFilename, "consent-proof.pdf");

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM lead_document_archive WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM lead_documents WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
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
