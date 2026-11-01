import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { createLead, updateLead, getLeadTimeline } from "../services/lead-service";
import { ROLES } from "../utils/roles";

// Verifies the client's exact complaint: editing a lead's plain fields
// (name, email, phone, ...) - not just category/status/owner/notes, which
// already had their own tracking - now shows up in History too.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function findOrCreateUser(email: string, name: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const user = await registerUser({ name, email, password: "Password123", role: ROLES.ADMIN });
  return user.id;
}

async function main(): Promise<void> {
  const userId = await findOrCreateUser("leadfieldhistory-admin.test@fieldforce.local", "Lead Field History Test Admin");

  const lead = await createLead({ fullName: "Original Name", email: "original@test.local", phone: "9876500001" }, userId);
  console.log("Lead created:", lead.id);

  // Edit 3 plain fields in one save, same as a real "Edit lead" form submit.
  await updateLead(
    lead.id,
    { fullName: "Updated Name", email: "updated@test.local", phone: "9876500002" },
    userId
  );

  const timeline = await getLeadTimeline(lead.id, userId);
  const fieldEvents = timeline.filter((e) => e.kind === "audit" && e.event?.action === "lead_field_updated");

  const nameEvent = fieldEvents.find((e) => e.event?.newValue === "Updated Name");
  assertEqual("Full name change produced a history entry", Boolean(nameEvent), true);
  assertEqual("Full name entry's old value is correct", nameEvent?.event?.oldValue, "Original Name");
  assertEqual("Full name entry's summary reads naturally", nameEvent?.event?.summary, "updated the full name");

  const emailEvent = fieldEvents.find((e) => e.event?.newValue === "updated@test.local");
  assertEqual("Email change produced a history entry", Boolean(emailEvent), true);
  assertEqual("Email entry's old value is correct", emailEvent?.event?.oldValue, "original@test.local");

  const phoneEvent = fieldEvents.find((e) => e.event?.newValue === "9876500002");
  assertEqual("Phone change produced a history entry", Boolean(phoneEvent), true);
  assertEqual("Phone entry's old value is correct", phoneEvent?.event?.oldValue, "9876500001");

  assertEqual("Exactly 3 field-change entries for this one edit (no duplicates)", fieldEvents.length, 3);

  // Saving again with no actual change must not produce a new entry.
  await updateLead(lead.id, { fullName: "Updated Name" }, userId);
  const timelineAfterNoopSave = await getLeadTimeline(lead.id, userId);
  const fieldEventsAfterNoop = timelineAfterNoopSave.filter((e) => e.kind === "audit" && e.event?.action === "lead_field_updated");
  assertEqual("Re-saving the same value does not add a new history entry", fieldEventsAfterNoop.length, 3);

  // category/status/owner/notes must still use their own existing, more
  // specific actions - not get double-logged under lead_field_updated too.
  await updateLead(lead.id, { category: "FOFO" }, userId);
  const timelineAfterCategory = await getLeadTimeline(lead.id, userId);
  const categoryFieldEvents = timelineAfterCategory.filter(
    (e) => e.kind === "audit" && e.event?.action === "lead_field_updated" && e.event?.summary.includes("category")
  );
  const categoryChangedEvents = timelineAfterCategory.filter((e) => e.kind === "audit" && e.event?.action === "category_changed");
  assertEqual("Category change still uses its own dedicated action", categoryChangedEvents.length, 1);
  assertEqual("Category change is NOT also double-logged as a generic field update", categoryFieldEvents.length, 0);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = $1", [lead.id]);
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
