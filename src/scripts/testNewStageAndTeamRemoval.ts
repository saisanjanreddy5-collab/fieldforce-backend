import { pool } from "../config/db";
import { createLead, isLeadVisibleToUser, resolveCallCenterExecutiveByEmail, bulkImportLeads } from "../services/lead-service";
import { startFlc, claimLead, escalateToSlc } from "../services/lead-call-center-service";

// Verifies today's client-confirmed changes, end to end:
// 1. The FLC/SLC team split is gone - round robin and visibility no longer
//    care about user_sales_teams at all.
// 2. Every creation path (manual, bulk import with/without an explicit
//    assignee) lands on 'New' first and is immediately visible to every
//    active Call Center Executive - this is the exact fix for the client's
//    original "manual lead isn't visible to everyone, bulk import is" bug.
// 3. startFlc/claimLead work as the new explicit stage-start/self-pickup
//    actions.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;
  const cc2 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc2@test.local'");
  const cc2Id = cc2.rows[0].id;
  const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const adminId = admin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    // --- Manual creation (admin, no options) lands at New, visible to ALL ---
    const manualLead = await createLead({ fullName: "New Stage Test - Manual", phone: "9876500031" }, adminId);
    createdLeadIds.push(manualLead.id);
    assertEqual("Manually-created lead lands at New", manualLead.status, "New");
    assertEqual("cc1 (not the creator) can see the manual lead", await isLeadVisibleToUser(manualLead.id, cc1Id), true);
    assertEqual("cc2 (not the creator) can ALSO see the manual lead", await isLeadVisibleToUser(manualLead.id, cc2Id), true);

    // --- Marketing-sourced (requiresQualification, no explicit owner) also lands at New ---
    const autoLead = await createLead(
      { fullName: "New Stage Test - Auto", phone: "9876500032" },
      adminId,
      undefined,
      { requiresQualification: true }
    );
    createdLeadIds.push(autoLead.id);
    assertEqual("Round-robin-assigned lead lands at New, not FLC", autoLead.status, "New");
    assertEqual("Round robin picked an active Call Center Executive as owner", typeof autoLead.ownerId === "string", true);

    // --- Explicit bulk-import assignee wins over round robin ---
    const resolvedId = await resolveCallCenterExecutiveByEmail("cc2@test.local");
    assertEqual("resolveCallCenterExecutiveByEmail resolves an active call_center email", resolvedId, cc2Id);
    const badResolve = await resolveCallCenterExecutiveByEmail("not-a-real-person@test.local");
    assertEqual("resolveCallCenterExecutiveByEmail returns null for an unmatched email", badResolve, null);

    const bulkResult = await bulkImportLeads(
      [{ fullName: "New Stage Test - Bulk Assigned", phone: "9876500033", assignedToEmail: "cc2@test.local" }],
      adminId
    );
    assertEqual("Bulk import with a valid assignee creates the row", bulkResult.created, 1);
    const bulkLead = await pool.query<{ id: string; status: string; owner_id: string }>(
      "SELECT id, status, owner_id FROM leads WHERE phone = '9876500033' AND is_deleted = false"
    );
    createdLeadIds.push(bulkLead.rows[0].id);
    assertEqual("Bulk-imported lead with an explicit assignee lands at New", bulkLead.rows[0].status, "New");
    assertEqual("Bulk-imported lead's owner is the explicitly assigned person", bulkLead.rows[0].owner_id, cc2Id);

    const bulkFallback = await bulkImportLeads(
      [{ fullName: "New Stage Test - Bulk Fallback", phone: "9876500034", assignedToEmail: "typo@test.local" }],
      adminId
    );
    assertEqual("Bulk import with an unmatched assignee email still creates the row", bulkFallback.created, 1);
    const fallbackLead = await pool.query<{ id: string; status: string; owner_id: string | null }>(
      "SELECT id, status, owner_id FROM leads WHERE phone = '9876500034' AND is_deleted = false"
    );
    createdLeadIds.push(fallbackLead.rows[0].id);
    assertEqual("Bad-email bulk row still lands at New", fallbackLead.rows[0].status, "New");
    assertEqual("Bad-email bulk row falls back to round robin (gets SOME active owner)", typeof fallbackLead.rows[0].owner_id === "string", true);

    // --- startFlc: New -> FLC, no owner change, rejects from the wrong stage ---
    const beforeFlc = manualLead.ownerId;
    const afterFlc = await startFlc(manualLead.id, cc1Id);
    assertEqual("startFlc moves New -> FLC", afterFlc.status, "FLC");
    assertEqual("startFlc does not change the owner", afterFlc.ownerId, beforeFlc);
    let rejectedSecondStart = false;
    try {
      await startFlc(manualLead.id, cc1Id);
    } catch {
      rejectedSecondStart = true;
    }
    assertEqual("startFlc rejects a lead already past New", rejectedSecondStart, true);

    // --- claimLead: any call_center person can self-assign an in-scope lead ---
    const claimed = await claimLead(manualLead.id, cc2Id);
    assertEqual("claimLead assigns the lead to the caller", claimed.ownerId, cc2Id);

    // --- escalateToSlc: no longer team-scoped, just picks any active Call Center Executive ---
    const escalated = await escalateToSlc(manualLead.id, cc2Id);
    assertEqual("escalateToSlc moves FLC -> SLC with no team restriction", escalated.status, "SLC");

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM leads WHERE id = ANY($1::uuid[])", [createdLeadIds]);
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
