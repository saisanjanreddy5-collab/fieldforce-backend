import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { createLead, isLeadInOwnerScope, isLeadVisibleToUser } from "../services/lead-service";
import { logCallDisposition } from "../services/lead-call-center-service";

// Verifies the "cover for an absent teammate" requirement: any FLC-team
// member can see/call ANY lead currently at FLC (not just their own), same
// for SLC, without owner_id ever changing to reflect who actually worked it
// - the activity log is what records the real actor (see
// lead-call-center-service.ts's logCallDisposition).

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

  // cc4: a second FLC-team member - tests "teammate, not owner" at FLC.
  const cc4Id = await findOrCreateFixture("cc4@test.local", "CC Agent 4", "EMP-TEST-CC4", "cc1@test.local");
  // cc5: a second SLC-team member - tests "teammate, not owner" at SLC.
  const cc5Id = await findOrCreateFixture("cc5@test.local", "CC Agent 5", "EMP-TEST-CC5", "cc2@test.local");

  // --- FLC tier: lead owned by cc1 ---
  const flcLead = await createLead(
    { fullName: "Tier Visibility Test - FLC", phone: "9876500021" },
    cc1Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );
  assertEqual("FLC lead lands at FLC, owned by cc1", flcLead.status, "FLC");

  assertEqual("FLC teammate (cc4) is in owner scope", await isLeadInOwnerScope(flcLead.id, cc4Id), true);
  assertEqual("SLC agent (cc2) is NOT in owner scope of an FLC lead", await isLeadInOwnerScope(flcLead.id, cc2Id), false);

  // Teammate actually logs a call - owner must stay cc1, actor must be cc4.
  await logCallDisposition(flcLead.id, { disposition: "Call Done And Interested" }, cc4Id);
  const afterCall = await pool.query<{ owner_id: string }>("SELECT owner_id FROM leads WHERE id = $1", [flcLead.id]);
  assertEqual("Owner unchanged after teammate logs a call", afterCall.rows[0].owner_id, cc1Id);
  const activity = await pool.query<{ created_by: string; assigned_to: string }>(
    "SELECT created_by, assigned_to FROM activities WHERE lead_id = $1 AND type = 'call' ORDER BY created_at DESC LIMIT 1",
    [flcLead.id]
  );
  assertEqual("Activity log attributes the call to the real actor (cc4)", activity.rows[0].created_by, cc4Id);

  // --- SLC tier: lead directly set up as owned by cc2 at SLC stage ---
  const slcLead = await createLead(
    { fullName: "Tier Visibility Test - SLC", phone: "9876500022" },
    cc2Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );
  await pool.query("UPDATE leads SET status = 'SLC', owner_id = $1 WHERE id = $2", [cc2Id, slcLead.id]);

  assertEqual("SLC teammate (cc5) is in owner scope", await isLeadInOwnerScope(slcLead.id, cc5Id), true);
  assertEqual("FLC teammate (cc4) is NOT in owner scope of an SLC lead", await isLeadInOwnerScope(slcLead.id, cc4Id), false);
  assertEqual("Original FLC owner (cc1) is NOT in owner scope of someone else's SLC lead", await isLeadInOwnerScope(slcLead.id, cc1Id), false);

  // Once Qualified, the handoff window is single-owner again - a teammate
  // keeps read-visibility (isLeadVisibleToUser uses the same clause too) only
  // through an explicit share, never bare tier-teammate standing.
  await pool.query("UPDATE leads SET status = 'Qualified' WHERE id = $1", [slcLead.id]);
  assertEqual("SLC teammate (cc5) loses owner scope once Qualified", await isLeadInOwnerScope(slcLead.id, cc5Id), false);
  assertEqual("SLC teammate (cc5) also loses plain visibility once Qualified", await isLeadVisibleToUser(slcLead.id, cc5Id), false);

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
