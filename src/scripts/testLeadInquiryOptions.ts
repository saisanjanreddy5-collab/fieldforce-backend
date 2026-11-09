import { pool } from "../config/db";
import {
  listLeadInquiryOptions,
  createLeadInquiryOption,
  updateLeadInquiryOption,
} from "../services/lead-inquiry-option-service";

// Covers the QA ticket "Inquiry Category and Source Fields": these were pure
// free text with zero master list, which fragments into junk over time
// ("Insta"/"Instagram"/"IG") and made the ticket's own complaint true - no
// way to tell where the values are meant to come from. Now backed by a real
// admin-editable table (lead_inquiry_options), used only for manual-entry
// leads - QR/Website leads keep being auto-filled/locked exactly as before.

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
  const createdIds: string[] = [];

  try {
    // --- Seed values already proven real (from QR/Website auto-fill) are present ---
    const seededCategories = await listLeadInquiryOptions("category");
    assertTrue("Seeded 'QR Code' category option exists", seededCategories.some((o) => o.label === "QR Code"));
    assertTrue("Seeded 'Website' category option exists", seededCategories.some((o) => o.label === "Website"));

    // --- Create, rejects duplicates, filters by fieldType ---
    const created = await createLeadInquiryOption({ fieldType: "source", label: "Instagram (Test)" });
    createdIds.push(created.id);
    assertEqual("New option starts active", created.isActive, true);

    await expectRejects(
      "Creating a duplicate label for the same field rejects",
      createLeadInquiryOption({ fieldType: "source", label: "Instagram (Test)" })
    );

    const sourcesOnly = await listLeadInquiryOptions("source");
    assertTrue("Listing by fieldType=source does not include category options", !sourcesOnly.some((o) => o.label === "QR Code"));
    assertTrue("Listing by fieldType=source includes the new source option", sourcesOnly.some((o) => o.id === created.id));

    // --- Update: rename and deactivate ---
    const renamed = await updateLeadInquiryOption(created.id, { label: "Instagram DM (Test)" });
    assertEqual("Rename took effect", renamed.label, "Instagram DM (Test)");

    const deactivated = await updateLeadInquiryOption(created.id, { isActive: false });
    assertEqual("Deactivate took effect", deactivated.isActive, false);

    const allSources = await listLeadInquiryOptions("source");
    const stillListed = allSources.find((o) => o.id === created.id);
    assertTrue("Deactivated option still appears in the full list (not deleted)", stillListed !== undefined);
    assertEqual("Deactivated option's isActive is false in the list too", stillListed?.isActive, false);

    // --- Permission seeding: admin(view+manage), manager/agent/call_center(view) ---
    const perms = await pool.query<{ role: string; permission: string }>(
      "SELECT role, permission FROM role_permissions WHERE permission LIKE 'lead_inquiry_options.%'"
    );
    const has = (role: string, permission: string) => perms.rows.some((r) => r.role === role && r.permission === permission);
    assertTrue("admin has lead_inquiry_options.view", has("admin", "lead_inquiry_options.view"));
    assertTrue("admin has lead_inquiry_options.manage", has("admin", "lead_inquiry_options.manage"));
    assertTrue("manager has lead_inquiry_options.view", has("manager", "lead_inquiry_options.view"));
    assertTrue("agent has lead_inquiry_options.view", has("agent", "lead_inquiry_options.view"));
    assertTrue("call_center has lead_inquiry_options.view", has("call_center", "lead_inquiry_options.view"));
    assertTrue("manager does NOT have lead_inquiry_options.manage", !has("manager", "lead_inquiry_options.manage"));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdIds.length > 0) {
      await pool.query("DELETE FROM lead_inquiry_options WHERE id = ANY($1::uuid[])", [createdIds]);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function expectRejects(label: string, promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    assertTrue(label, false);
  } catch {
    assertTrue(label, true);
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
