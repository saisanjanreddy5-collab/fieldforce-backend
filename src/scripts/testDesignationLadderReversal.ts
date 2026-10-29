import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { createTables } from "../models/model";

// Verifies the production fix for the "chutney" designation ladder: FLC
// Executive/SLC Executive must collapse back into one "Call Center
// Executive" level, their users move back onto it, and anyone left on the
// old "SKIA Call Center Team" gets unassigned (not guessed) rather than
// permanently blocking that team's removal. Simulates production's exact
// broken state first (since local dev had already drifted past it), then
// runs the real migration runner (createTables) end to end.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function createFixtureUser(email: string, name: string, levelId: string, salesTeamId: string | null): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  const passwordHash = await bcrypt.hash("Password123", 10);
  if (existing.rows.length > 0) {
    await pool.query("UPDATE users SET level_id = $1, sales_team_id = $2 WHERE id = $3", [levelId, salesTeamId, existing.rows[0].id]);
    return existing.rows[0].id;
  }
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, level_id, sales_team_id, is_active, employee_code, status)
     VALUES ($1, $2, $3, 'call_center', $4, $5, true, $6, 'active') RETURNING id`,
    [name, email, passwordHash, levelId, salesTeamId, `EMP-${email.split("@")[0].toUpperCase()}`]
  );
  return inserted.rows[0].id;
}

async function main(): Promise<void> {
  const ccExec = await pool.query<{
    id: string;
    description: string | null;
    headcount_limit: number | null;
    approval_ceiling: number | null;
    security_tier: string;
    is_cross_cutting: boolean;
    record_scope: string;
    sees_label_override: string | null;
    approval_label_override: string | null;
    can_edit_label: boolean;
    see_credit_fields: boolean;
    see_margin_fields: boolean;
    can_export: boolean;
    can_view_call_recordings: boolean;
    can_see_unmasked_pii: boolean;
  }>("SELECT * FROM levels WHERE name = 'Call Center Executive'");
  if (ccExec.rows.length === 0) {
    console.error("Local DB has no 'Call Center Executive' level to clone from - cannot simulate the production state. Aborting.");
    process.exit(1);
  }
  const l = ccExec.rows[0];

  // Simulate production's broken "chutney": FLC Executive + SLC Executive
  // exist alongside the still-populated Call Center Executive ghost level.
  for (const name of ["FLC Executive", "SLC Executive"]) {
    await pool.query(
      `INSERT INTO levels (
         name, sort_order, description, headcount_limit, approval_ceiling, security_tier, is_cross_cutting,
         record_scope, sees_label_override, approval_label_override, can_edit_label,
         see_credit_fields, see_margin_fields, can_export, can_view_call_recordings, can_see_unmasked_pii
       ) VALUES ($1, 99, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (name) DO NOTHING`,
      [
        name,
        l.description,
        l.headcount_limit,
        l.approval_ceiling,
        l.security_tier,
        l.is_cross_cutting,
        l.record_scope,
        l.sees_label_override,
        l.approval_label_override,
        l.can_edit_label,
        l.see_credit_fields,
        l.see_margin_fields,
        l.can_export,
        l.can_view_call_recordings,
        l.can_see_unmasked_pii,
      ]
    );
  }
  const flcLevel = await pool.query<{ id: string }>("SELECT id FROM levels WHERE name = 'FLC Executive'");
  const slcLevel = await pool.query<{ id: string }>("SELECT id FROM levels WHERE name = 'SLC Executive'");
  const flcLevelId = flcLevel.rows[0].id;
  const slcLevelId = slcLevel.rows[0].id;

  await pool.query(
    "INSERT INTO sales_teams (name) SELECT 'SKIA Call Center Team' WHERE NOT EXISTS (SELECT 1 FROM sales_teams WHERE name = 'SKIA Call Center Team')"
  );
  const oldTeam = await pool.query<{ id: string }>("SELECT id FROM sales_teams WHERE name = 'SKIA Call Center Team'");
  const oldTeamId = oldTeam.rows[0].id;

  const flcUserId = await createFixtureUser("ladder-test-flc@test.local", "Ladder Test FLC", flcLevelId, null);
  const slcUserId = await createFixtureUser("ladder-test-slc@test.local", "Ladder Test SLC", slcLevelId, null);
  const oldTeamUserId = await createFixtureUser("ladder-test-oldteam@test.local", "Ladder Test Old Team", l.id, oldTeamId);

  // The real migration runner - every statement in model.ts, including the
  // reversal migration being verified here, run exactly as a real server
  // boot would run them.
  await createTables();

  const levelsAfter = await pool.query<{ name: string }>("SELECT name FROM levels WHERE name IN ('FLC Executive', 'SLC Executive')");
  assertEqual("FLC Executive/SLC Executive levels are gone", levelsAfter.rows.length, 0);

  const ccExecAfter = await pool.query<{ id: string; sort_order: number }>("SELECT id, sort_order FROM levels WHERE name = 'Call Center Executive'");
  assertEqual("Call Center Executive still exists", ccExecAfter.rows.length, 1);
  assertEqual("Call Center Executive sort_order is 1", ccExecAfter.rows[0]?.sort_order, 1);

  const fieldSales = await pool.query<{ sort_order: number }>("SELECT sort_order FROM levels WHERE name = 'Field Sales Executive'");
  assertEqual("Field Sales Executive sort_order is 2", fieldSales.rows[0]?.sort_order, 2);

  const flcUser = await pool.query<{ level_id: string }>("SELECT level_id FROM users WHERE id = $1", [flcUserId]);
  assertEqual("Former FLC Executive user moved to Call Center Executive", flcUser.rows[0].level_id, ccExecAfter.rows[0].id);

  const slcUser = await pool.query<{ level_id: string }>("SELECT level_id FROM users WHERE id = $1", [slcUserId]);
  assertEqual("Former SLC Executive user moved to Call Center Executive", slcUser.rows[0].level_id, ccExecAfter.rows[0].id);

  const oldTeamUser = await pool.query<{ sales_team_id: string | null }>("SELECT sales_team_id FROM users WHERE id = $1", [oldTeamUserId]);
  assertEqual("User on the old SKIA Call Center Team is unassigned, not guessed", oldTeamUser.rows[0].sales_team_id, null);

  const teamAfter = await pool.query<{ name: string }>("SELECT name FROM sales_teams WHERE name = 'SKIA Call Center Team'");
  assertEqual("SKIA Call Center Team is deleted now that it's empty", teamAfter.rows.length, 0);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM users WHERE id = ANY($1)", [[flcUserId, slcUserId, oldTeamUserId]]);

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
