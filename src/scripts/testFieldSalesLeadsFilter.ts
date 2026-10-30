import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { createLead, listLeadsForUser, getQuickFilterCounts } from "../services/lead-service";

// Verifies the "Field Sales Executive's Leads module is a curated, ready-to-
// work view" requirement: a lead still sitting at a raw calling stage
// (New/FLC/SLC) stays out of an agent's own Leads list, UNLESS the agent
// added it themselves - and the rule never affects any other role, since
// Call Center's whole job is working those raw stages.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1");
  const adminId = admin.rows[0].id;

  const existingFs = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'fs-filter-test@test.local'");
  let fsId: string;
  if (existingFs.rows.length > 0) {
    fsId = existingFs.rows[0].id;
  } else {
    const passwordHash = await bcrypt.hash("Password123", 10);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, manager_id, is_active, status)
       VALUES ('Field Sales Filter Test', 'fs-filter-test@test.local', $1, 'agent', $2, true, 'active') RETURNING id`,
      [passwordHash, adminId]
    );
    fsId = inserted.rows[0].id;
  }

  // Lead A: the field rep adds this one themselves, via the plain "New lead"
  // form (no requiresQualification option - matches the real controller
  // path). Lands at 'New', owned by its own creator - must stay visible
  // despite being a raw stage, or adding your own lead would make it vanish.
  const leadA = await createLead({ fullName: "FS Filter Test - Self Added", phone: "9876500091" }, fsId);
  assertEqual("Self-added lead lands at New, owned by the field rep", leadA.status === "New" && leadA.ownerId === fsId, true);

  // Lead B: a raw FLC lead that ends up owned by the field rep (the stray
  // edge case this filter guards against - e.g. a mis-click Reassign).
  const leadB = await createLead(
    { fullName: "FS Filter Test - Stray FLC", phone: "9876500092", status: "FLC", ownerId: fsId },
    adminId
  );

  // Lead C: already past Call Center, owned by the field rep - the normal,
  // expected case once Call Center hands a lead off.
  const leadC = await createLead(
    { fullName: "FS Filter Test - Qualified", phone: "9876500093", status: "Qualified", ownerId: fsId },
    adminId
  );

  const fsList = await listLeadsForUser(fsId, { page: 1, limit: 100 });
  const fsIds = new Set(fsList.leads.map((l) => l.id));
  assertEqual("Field rep sees their own self-added New lead", fsIds.has(leadA.id), true);
  assertEqual("Field rep does NOT see the stray raw FLC lead", fsIds.has(leadB.id), false);
  assertEqual("Field rep sees the Qualified lead handed to them", fsIds.has(leadC.id), true);

  // The rule must be a no-op for every other role - admin still sees all
  // three, including the one hidden from the field rep's own list.
  const adminList = await listLeadsForUser(adminId, { page: 1, limit: 500 });
  const adminIds = new Set(adminList.leads.map((l) => l.id));
  assertEqual("Admin still sees the self-added lead", adminIds.has(leadA.id), true);
  assertEqual("Admin still sees the stray raw FLC lead (rule is a no-op for admin)", adminIds.has(leadB.id), true);
  assertEqual("Admin still sees the Qualified lead", adminIds.has(leadC.id), true);

  // Quick filter counts (the chips above the Leads list) must agree with the
  // list itself - 2 visible (A, C), not 3.
  const counts = await getQuickFilterCounts(fsId);
  assertEqual("Quick filter 'My leads' count matches the filtered list (2, not 3)", counts.myLeads, 2);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  const leadIds = [leadA.id, leadB.id, leadC.id];
  await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1)", [leadIds]);
  await pool.query("DELETE FROM activities WHERE lead_id = ANY($1)", [leadIds]);
  await pool.query("DELETE FROM leads WHERE id = ANY($1)", [leadIds]);

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
