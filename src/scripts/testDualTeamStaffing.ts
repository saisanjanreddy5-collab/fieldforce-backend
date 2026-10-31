import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { updateUser } from "../services/user-service";
import { createLead, isLeadVisibleToUser, getSalesTeamIdByName, resolveTierAssignee, FLC_STAGE, SLC_STAGE } from "../services/lead-service";
import { ROLES } from "../utils/roles";

// Verifies the "one Call Center Executive can be staffed on both FLC and
// SLC at once" fix: the join-table rewrite of resolveTierAssignee and
// TIER_TEAMMATE_CLAUSE must actually treat a dual-staffed person as a real
// member of both teams, for both round-robin assignment and teammate
// visibility - not just whichever single team the old column held.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const flcTeamId = await getSalesTeamIdByName("FLC Team");
  const slcTeamId = await getSalesTeamIdByName("SLC Team");
  if (!flcTeamId || !slcTeamId) {
    throw new Error("FLC Team / SLC Team rows not found - seed data missing");
  }

  // A clean, isolated pair: deactivate every OTHER active call_center user
  // first so round-robin has nobody else to pick instead - restored at the
  // end regardless of pass/fail.
  const othersResult = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'call_center' AND is_active = true AND email NOT LIKE '%dualteamtest@test.local'"
  );
  const otherIds = othersResult.rows.map((r) => r.id);
  if (otherIds.length > 0) {
    await pool.query("UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])", [otherIds]);
  }

  try {
    const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'dualteamtest@test.local'");
    let dualId: string;
    if (existing.rows.length > 0) {
      dualId = existing.rows[0].id;
      await pool.query("UPDATE users SET is_active = true WHERE id = $1", [dualId]);
      await updateUser(dualId, { salesTeamIds: [flcTeamId, slcTeamId] }, dualId);
    } else {
      const created = await registerUser({
        name: "Dual Team Test",
        email: "dualteamtest@test.local",
        password: "Password123",
        role: ROLES.CALL_CENTER,
        salesTeamIds: [flcTeamId, slcTeamId],
      });
      dualId = created.id;
    }

    // Round-robin check runs with dualId as the ONLY active candidate on
    // either team (the SLC-only teammate below isn't created/activated
    // yet) - proves dualId is genuinely matched by both team lookups,
    // rather than leaving it to a random tiebreak between two equally
    // valid people once a second SLC candidate exists.
    console.log("--- Round-robin: the dual-staffed person must be matched for BOTH tiers ---");
    assertEqual("Dual-staffed person is picked for FLC round-robin", await resolveTierAssignee(flcTeamId, FLC_STAGE), dualId);
    assertEqual("Dual-staffed person is picked for SLC round-robin", await resolveTierAssignee(slcTeamId, SLC_STAGE), dualId);

    const sideResult = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'slconlyteammatetest@test.local'");
    let slcOnlyId: string;
    if (sideResult.rows.length > 0) {
      slcOnlyId = sideResult.rows[0].id;
      await pool.query("UPDATE users SET is_active = true WHERE id = $1", [slcOnlyId]);
      await updateUser(slcOnlyId, { salesTeamIds: [slcTeamId] }, slcOnlyId);
    } else {
      const created = await registerUser({
        name: "SLC Only Teammate Test",
        email: "slconlyteammatetest@test.local",
        password: "Password123",
        role: ROLES.CALL_CENTER,
        salesTeamIds: [slcTeamId],
      });
      slcOnlyId = created.id;
    }

    console.log("\n--- Teammate visibility: dual-staffed person must see an SLC-only teammate's SLC lead ---");
    const slcLead = await createLead({ fullName: "Dual Team Test - SLC Lead", status: SLC_STAGE, ownerId: slcOnlyId }, slcOnlyId);
    assertEqual("Dual-staffed person (also on SLC) can see the SLC teammate's lead", await isLeadVisibleToUser(slcLead.id, dualId), true);

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

    await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = $1", [slcLead.id]);
    await pool.query("DELETE FROM activities WHERE lead_id = $1", [slcLead.id]);
    await pool.query("DELETE FROM leads WHERE id = $1", [slcLead.id]);
  } finally {
    // Always restore whoever else was active, pass or fail.
    if (otherIds.length > 0) {
      await pool.query("UPDATE users SET is_active = true WHERE id = ANY($1::uuid[])", [otherIds]);
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
