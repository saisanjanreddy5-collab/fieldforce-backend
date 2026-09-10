import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { createLead, isLeadVisibleToUser, shareLead } from "../services/lead-service";
import { ROLES, Role } from "../utils/roles";

// Reproduces the exact worked example from the spec:
//   Sanjan, Hari, Indra, Revanth all report to Manoj.
//   Manoj and Omkar both report to Raju.
//   Charan reports to Omkar.
//   A lead assigned to Sanjan must be visible to: Sanjan, Manoj, Raju.
//   It must NOT be visible to: Omkar, Charan (different branch, even though
//   Raju is a shared ancestor) - or to Hari/Indra/Revanth (Sanjan's siblings).
//   Once explicitly shared with Charan, Charan must then see it too.

interface SeedUserSpec {
  key: string;
  name: string;
  email: string;
  role: Role;
  managerKey: string | null;
}

const USER_SPECS: SeedUserSpec[] = [
  { key: "raju", name: "Raju", email: "raju.test@fieldforce.local", role: ROLES.MANAGER, managerKey: null },
  { key: "manoj", name: "Manoj", email: "manoj.test@fieldforce.local", role: ROLES.MANAGER, managerKey: "raju" },
  { key: "omkar", name: "Omkar", email: "omkar.test@fieldforce.local", role: ROLES.MANAGER, managerKey: "raju" },
  { key: "charan", name: "Charan", email: "charan.test@fieldforce.local", role: ROLES.AGENT, managerKey: "omkar" },
  { key: "sanjan", name: "Sanjan", email: "sanjan.test@fieldforce.local", role: ROLES.AGENT, managerKey: "manoj" },
  { key: "hari", name: "Hari", email: "hari.test@fieldforce.local", role: ROLES.AGENT, managerKey: "manoj" },
  { key: "indra", name: "Indra", email: "indra.test@fieldforce.local", role: ROLES.AGENT, managerKey: "manoj" },
  { key: "revanth", name: "Revanth", email: "revanth.test@fieldforce.local", role: ROLES.AGENT, managerKey: "manoj" },
];

async function findOrCreateUser(spec: SeedUserSpec, managerId: string | null): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [spec.email]);
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await pool.query("UPDATE users SET manager_id = $1 WHERE id = $2", [managerId, id]);
    return id;
  }

  const user = await registerUser({
    name: spec.name,
    email: spec.email,
    password: "Password123",
    role: spec.role,
    managerId: managerId ?? undefined,
  });
  return user.id;
}

let failures = 0;

function assertEqual(label: string, actual: boolean, expected: boolean): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${expected}, got ${actual})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const ids: Record<string, string> = {};

  // Create in dependency order so each manager already exists when referenced.
  for (const spec of USER_SPECS) {
    const managerId = spec.managerKey ? ids[spec.managerKey] : null;
    ids[spec.key] = await findOrCreateUser(spec, managerId);
  }

  console.log("Users ready:", ids);

  const lead = await createLead({ fullName: "Test Lead For Hierarchy Visibility" }, ids.sanjan);
  console.log("Lead created:", lead.id, "owned by Sanjan");

  console.log("\n--- Before sharing (Rule A only) ---");
  assertEqual("Sanjan (owner) can see the lead", await isLeadVisibleToUser(lead.id, ids.sanjan), true);
  assertEqual("Manoj (Sanjan's manager) can see the lead", await isLeadVisibleToUser(lead.id, ids.manoj), true);
  assertEqual("Raju (Manoj's manager) can see the lead", await isLeadVisibleToUser(lead.id, ids.raju), true);
  assertEqual("Omkar (different branch) cannot see the lead", await isLeadVisibleToUser(lead.id, ids.omkar), false);
  assertEqual("Charan (different branch) cannot see the lead", await isLeadVisibleToUser(lead.id, ids.charan), false);
  assertEqual("Hari (Sanjan's sibling) cannot see the lead", await isLeadVisibleToUser(lead.id, ids.hari), false);
  assertEqual("Indra (Sanjan's sibling) cannot see the lead", await isLeadVisibleToUser(lead.id, ids.indra), false);
  assertEqual("Revanth (Sanjan's sibling) cannot see the lead", await isLeadVisibleToUser(lead.id, ids.revanth), false);

  console.log("\n--- Sharing the lead with Charan (Rule B) ---");
  await shareLead(lead.id, ids.charan, ids.sanjan);
  assertEqual("Charan can now see the lead after being shared with", await isLeadVisibleToUser(lead.id, ids.charan), true);
  assertEqual("Omkar still cannot see the lead (share was only with Charan)", await isLeadVisibleToUser(lead.id, ids.omkar), false);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

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
