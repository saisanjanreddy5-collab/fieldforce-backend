import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { createLead, getLeadConsent } from "../services/lead-service";
import { getHandoff } from "../services/fofo-onboarding-service";
import { ROLES } from "../utils/roles";

// Reproduces the real bug reported in production: an admin opening a FOFO
// handoff whose lead owner falls outside their own manager subtree got the
// lead fine (getLeadById's own skipVisibilityCheck already covers that) but
// a 403 from the separate /leads/:id/consent call, which had no such bypass
// - FofoHandoffDetail.tsx's Promise.all then failed the whole page on that
// one 403 even though the handoff itself loaded. Admin here deliberately has
// no manager (a second, disconnected root) so owner is provably outside
// their subtree, same shape as the real production case.

async function findOrCreateUser(email: string, name: string, role: (typeof ROLES)[keyof typeof ROLES]): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const user = await registerUser({ name, email, password: "Password123", role });
  return user.id;
}

let failures = 0;
function assertEqual(label: string, actual: boolean, expected: boolean): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${expected}, got ${actual})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const adminId = await findOrCreateUser("fofo-consent-admin.test@fieldforce.local", "FOFO Consent Test Admin", ROLES.ADMIN);
  const ownerId = await findOrCreateUser("fofo-consent-owner.test@fieldforce.local", "FOFO Consent Test Owner", ROLES.CALL_CENTER);
  // Owner must have no manager at all - a manager chain that never reaches
  // adminId is what puts it outside admin's subtree.
  await pool.query("UPDATE users SET manager_id = NULL WHERE id = $1", [ownerId]);

  const lead = await createLead({ fullName: "FOFO Consent Visibility Test Lead", category: "FOFO" }, ownerId);
  console.log("Lead created:", lead.id, "owned by test owner (no manager, outside admin's subtree)");

  console.log("\n--- Before fix behavior (direct getLeadConsent, no bypass) ---");
  let threw403 = false;
  try {
    await getLeadConsent(lead.id, adminId);
  } catch (err) {
    threw403 = (err as { statusCode?: number }).statusCode === 403;
  }
  assertEqual("Direct getLeadConsent still 403s for admin outside subtree (expected, unchanged)", threw403, true);

  console.log("\n--- After fix: getHandoff (what the FOFO page actually calls) ---");
  let handoffSucceeded = false;
  let consentIncluded = false;
  try {
    const handoff = await getHandoff(lead.id, adminId, "admin");
    handoffSucceeded = true;
    consentIncluded = "consent" in handoff;
  } catch (err) {
    console.error("getHandoff threw:", err);
  }
  assertEqual("getHandoff succeeds for admin outside subtree (no more 403 on consent)", handoffSucceeded, true);
  assertEqual("getHandoff response includes a consent field", consentIncluded, true);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  // Clean up the lead (and its derived approval steps/documents via FK
  // cascade) each run - unlike the users above, re-running this would
  // otherwise pile up a fresh lead every time.
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
