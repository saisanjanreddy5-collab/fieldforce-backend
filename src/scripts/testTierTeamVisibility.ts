import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { createLead, isLeadInOwnerScope, isLeadVisibleToUser } from "../services/lead-service";
import { logCallDisposition } from "../services/lead-call-center-service";

// Verifies the client-confirmed, explicit rule: EVERY active Call Center
// Executive can see/work ANY lead currently at FLC or SLC, regardless of
// which team (FLC/SLC) they themselves are tagged as - a freshly
// bulk-imported batch must be visible to the whole Call Center floor right
// away, not just whoever happens to share the lead's team tag. owner_id
// never changes just because a non-owner worked it - the activity log is
// what records the real actor (see lead-call-center-service.ts's
// logCallDisposition). Once a lead reaches Qualified, this blanket coverage
// no longer applies - that handoff window is still single-owner by design,
// unrelated to the FLC/SLC team-tagging question this test is about.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${expected}, got ${actual})`);
  if (!pass) failures += 1;
}

async function findOrCreateFixture(email: string, name: string, employeeCode: string, likeEmail: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const template = await pool.query<{ manager_id: string; sales_team_id: string; level_id: string }>(
    "SELECT manager_id, sales_team_id, level_id FROM users WHERE email = $1",
    [likeEmail]
  );
  const { manager_id, sales_team_id, level_id } = template.rows[0];
  const passwordHash = await bcrypt.hash("Password123", 10);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, manager_id, sales_team_id, level_id, is_active, employee_code, status)
     VALUES ($1, $2, $3, 'call_center', $4, $5, $6, true, $7, 'active') RETURNING id`,
    [name, email, passwordHash, manager_id, sales_team_id, level_id, employeeCode]
  );
  return inserted.rows[0].id;
}

async function main(): Promise<void> {
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;
  const cc2 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc2@test.local'");
  const cc2Id = cc2.rows[0].id;

  // cc4/cc5: two more call_center fixtures (one FLC-tagged, one SLC-tagged
  // by inheritance from their templates) - used to prove this generalizes to
  // any call_center person, not just the two primary fixtures.
  const cc4Id = await findOrCreateFixture("cc4@test.local", "CC Agent 4", "EMP-TEST-CC4", "cc1@test.local");
  const cc5Id = await findOrCreateFixture("cc5@test.local", "CC Agent 5", "EMP-TEST-CC5", "cc2@test.local");

  // --- FLC tier: lead owned by cc1 ---
  const flcLead = await createLead(
    { fullName: "Tier Visibility Test - FLC", phone: "9876500021" },
    cc1Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );
  assertEqual("FLC lead lands at FLC, owned by cc1", flcLead.status, "FLC");

  assertEqual("Same-team call center person (cc4) is in owner scope", await isLeadInOwnerScope(flcLead.id, cc4Id), true);
  assertEqual("Cross-team call center person (cc2, SLC) is ALSO in owner scope of an FLC lead", await isLeadInOwnerScope(flcLead.id, cc2Id), true);

  // A cross-team person actually logs a call - owner must stay cc1, actor must be cc2.
  await logCallDisposition(flcLead.id, { disposition: "Call Done And Interested" }, cc2Id);
  const afterCall = await pool.query<{ owner_id: string }>("SELECT owner_id FROM leads WHERE id = $1", [flcLead.id]);
  assertEqual("Owner unchanged after a cross-team person logs a call", afterCall.rows[0].owner_id, cc1Id);
  const activity = await pool.query<{ created_by: string; assigned_to: string }>(
    "SELECT created_by, assigned_to FROM activities WHERE lead_id = $1 AND type = 'call' ORDER BY created_at DESC LIMIT 1",
    [flcLead.id]
  );
  assertEqual("Activity log attributes the call to the real actor (cc2)", activity.rows[0].created_by, cc2Id);

  // --- SLC tier: lead directly set up as owned by cc2 at SLC stage ---
  const slcLead = await createLead(
    { fullName: "Tier Visibility Test - SLC", phone: "9876500022" },
    cc2Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );
  await pool.query("UPDATE leads SET status = 'SLC', owner_id = $1 WHERE id = $2", [cc2Id, slcLead.id]);

  assertEqual("Same-team call center person (cc5) is in owner scope", await isLeadInOwnerScope(slcLead.id, cc5Id), true);
  assertEqual("Cross-team call center person (cc4, FLC) is ALSO in owner scope of an SLC lead", await isLeadInOwnerScope(slcLead.id, cc4Id), true);
  assertEqual("Original FLC owner (cc1) is ALSO in owner scope of someone else's SLC lead", await isLeadInOwnerScope(slcLead.id, cc1Id), true);

  // Once Qualified, the handoff window is single-owner again for OWNER
  // SCOPE (can call/edit/act) - that blanket call-center coverage no longer
  // applies there (unrelated to team tagging). Plain VISIBILITY is a
  // different story, per the client's later, separate, explicit
  // confirmation: every active Call Center Executive can look up ANY lead
  // forever, read-only, even long after it's left the floor - see
  // CALL_CENTER_UNIVERSAL_VISIBILITY_CLAUSE's own comment in lead-service.ts.
  await pool.query("UPDATE leads SET status = 'Qualified' WHERE id = $1", [slcLead.id]);
  assertEqual("Non-owner call center person (cc5) loses owner scope once Qualified", await isLeadInOwnerScope(slcLead.id, cc5Id), false);
  assertEqual("Non-owner call center person (cc5) keeps read-only visibility forever, even once Qualified", await isLeadVisibleToUser(slcLead.id, cc5Id), true);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM activities WHERE lead_id = ANY($1)", [[flcLead.id, slcLead.id]]);
  await pool.query("DELETE FROM leads WHERE id = ANY($1)", [[flcLead.id, slcLead.id]]);

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
