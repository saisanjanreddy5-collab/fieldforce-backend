import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { createLead, isLeadInOwnerScope, isLeadVisibleToUser, shareLead } from "../services/lead-service";
import { convertLeadToOpportunity } from "../services/opportunity-service";
import {
  addComment,
  createActivityForLead,
  deleteActivity,
  isActivityInOwnerScope,
  isActivityVisibleToUser,
  updateActivity,
} from "../services/activity-service";
import { ApiError } from "../utils/ApiError";
import { ROLES, Role } from "../utils/roles";

// Phase 3C correction pass:
//   1. Lead conversion is a mutation (it also flips the source lead's status
//      to 'converted'), so it must require owner scope, not mere shared
//      visibility - a shared-but-not-owned user must be denied.
//   2. Activity commenting is deliberately left on the broad view scope -
//      it's a collaborative action, not a modification of the activity's
//      own record - so a shared user CAN comment even though they cannot
//      update/delete the activity.

interface SeedUserSpec {
  key: string;
  name: string;
  email: string;
  role: Role;
  managerKey: string | null;
}

const USER_SPECS: SeedUserSpec[] = [
  { key: "manager", name: "P3Cfix Manager", email: "p3cfix.manager@fieldforce.local", role: ROLES.MANAGER, managerKey: null },
  { key: "owner", name: "P3Cfix Owner", email: "p3cfix.owner@fieldforce.local", role: ROLES.AGENT, managerKey: "manager" },
  { key: "peer", name: "P3Cfix Peer", email: "p3cfix.peer@fieldforce.local", role: ROLES.AGENT, managerKey: "manager" },
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

async function assertDeniedWith403(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`FAIL - ${label} (expected a 403 ApiError, but the call succeeded)`);
    failures += 1;
  } catch (err) {
    const status = err instanceof ApiError ? err.statusCode : undefined;
    const pass = status === 403;
    console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected 403, got ${status ?? err})`);
    if (!pass) failures += 1;
  }
}

async function assertSucceeds(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`PASS - ${label} (succeeded as expected)`);
  } catch (err) {
    console.log(`FAIL - ${label} (expected to succeed, but threw: ${err})`);
    failures += 1;
  }
}

async function main(): Promise<void> {
  const ids: Record<string, string> = {};
  for (const spec of USER_SPECS) {
    const managerId = spec.managerKey ? ids[spec.managerKey] : null;
    ids[spec.key] = await findOrCreateUser(spec, managerId);
  }
  console.log("Users ready:", ids);

  console.log("\n--- Scenario A: shared-but-not-owned lead cannot be converted ---");
  const leadA = await createLead({ fullName: "P3Cfix Conversion Test Lead A" }, ids.owner);
  await shareLead(leadA.id, ids.peer, ids.owner);
  assertEqual("peer can view the shared lead", await isLeadVisibleToUser(leadA.id, ids.peer), true);
  assertEqual("peer is NOT in owner scope for the shared lead", await isLeadInOwnerScope(leadA.id, ids.peer), false);
  await assertDeniedWith403("peer (shared, not owner) cannot convert the lead", () =>
    convertLeadToOpportunity(leadA.id, { name: "should fail" }, ids.peer)
  );

  console.log("\n--- Scenario B: real owner/subtree user retains conversion behavior ---");
  await assertSucceeds("owner can convert their own lead", () =>
    convertLeadToOpportunity(leadA.id, { name: "P3Cfix Opp A" }, ids.owner)
  );

  const leadB = await createLead({ fullName: "P3Cfix Conversion Test Lead B" }, ids.owner);
  await assertSucceeds("manager (subtree, not direct owner) can convert a subordinate's lead", () =>
    convertLeadToOpportunity(leadB.id, { name: "P3Cfix Opp B" }, ids.manager)
  );

  console.log("\n--- Scenario C: shared activity - view/comment allowed, update/delete denied ---");
  const leadC = await createLead({ fullName: "P3Cfix Activity Test Lead C" }, ids.owner);
  const activity = await createActivityForLead(leadC.id, { type: "call", subject: "P3Cfix test activity" }, ids.owner);
  await shareLead(leadC.id, ids.peer, ids.owner);

  assertEqual("peer can view the shared activity", await isActivityVisibleToUser(activity.id, ids.peer), true);
  assertEqual(
    "peer is NOT in owner scope for the shared activity",
    await isActivityInOwnerScope(activity.id, ids.peer),
    false
  );
  await assertSucceeds("peer (shared) CAN comment on the activity", () =>
    addComment(activity.id, "shared user commenting", ids.peer)
  );
  await assertDeniedWith403("peer (shared) CANNOT update the activity", () =>
    updateActivity(activity.id, { status: "completed" }, ids.peer)
  );
  await assertDeniedWith403("peer (shared) CANNOT delete the activity", () => deleteActivity(activity.id, ids.peer));

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
