import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { createLead, isLeadVisibleToUser, listLeadsForUser } from "../services/lead-service";
import { convertLeadToOpportunity, isOpportunityVisibleToUser, listOpportunitiesForUser } from "../services/opportunity-service";

// Verifies the "admin is a global role" fix: two independent admin accounts
// (no manager relationship between them, not in each other's reporting
// subtree) must see the exact same leads/opportunities, not just whatever
// happens to sit under their own branch. Before this fix, admin was treated
// exactly like a manager - just the top of its own subtree - so a lead owned
// by someone under Admin A's branch was invisible to Admin B entirely.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function findOrCreateUser(email: string, name: string, role: string, managerId: string | null): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await pool.query("UPDATE users SET manager_id = $1 WHERE id = $2", [managerId, id]);
    return id;
  }
  const passwordHash = await bcrypt.hash("Password123", 10);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, manager_id, is_active, status)
     VALUES ($1, $2, $3, $4, $5, true, 'active') RETURNING id`,
    [name, email, passwordHash, role, managerId]
  );
  return inserted.rows[0].id;
}

async function main(): Promise<void> {
  // Two independent admin peers - neither manages the other.
  const adminAId = await findOrCreateUser("admin-a-globaltest@test.local", "Admin A Global Test", "admin", null);
  const adminBId = await findOrCreateUser("admin-b-globaltest@test.local", "Admin B Global Test", "admin", null);
  // A regular manager sitting under Admin A's own branch only.
  const managerUnderAId = await findOrCreateUser("manager-under-a-globaltest@test.local", "Manager Under A", "manager", adminAId);
  console.log("Users ready:", { adminAId, adminBId, managerUnderAId });

  console.log("\n--- Leads: Admin B must see a lead owned deep in Admin A's branch ---");
  const lead = await createLead({ fullName: "Admin Global Visibility Test Lead" }, managerUnderAId);
  assertEqual("Admin A (same branch) can see the lead", await isLeadVisibleToUser(lead.id, adminAId), true);
  assertEqual("Admin B (unrelated branch) can ALSO see the lead", await isLeadVisibleToUser(lead.id, adminBId), true);

  const adminBList = await listLeadsForUser(adminBId, { page: 1, limit: 500 });
  assertEqual("Admin B's own Leads list includes it too", adminBList.leads.some((l) => l.id === lead.id), true);

  console.log("\n--- Opportunities: same check, one tier up ---");
  const opp = await convertLeadToOpportunity(lead.id, {}, managerUnderAId);
  assertEqual("Admin A (same branch) can see the opportunity", await isOpportunityVisibleToUser(opp.id, adminAId), true);
  assertEqual("Admin B (unrelated branch) can ALSO see the opportunity", await isOpportunityVisibleToUser(opp.id, adminBId), true);

  const adminBOpps = await listOpportunitiesForUser(adminBId, { page: 1, limit: 500 });
  assertEqual("Admin B's own Opportunities list includes it too", adminBOpps.opportunities.some((o) => o.id === opp.id), true);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  // Clean up the ephemeral lead/opportunity this run created; the 3 fixture
  // users are kept as permanent, reusable accounts for future runs.
  await pool.query("DELETE FROM audit_log WHERE entity_type IN ('lead', 'opportunity') AND entity_id IN ($1, $2)", [lead.id, opp.id]);
  await pool.query("DELETE FROM activities WHERE lead_id = $1 OR opportunity_id = $2", [lead.id, opp.id]);
  // convertLeadToOpportunity auto-creates a customer row from the lead - has
  // to go before the lead itself, or the FK's RESTRICT blocks the delete.
  await pool.query("DELETE FROM customers WHERE lead_id = $1", [lead.id]);
  await pool.query("DELETE FROM opportunities WHERE id = $1", [opp.id]);
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
