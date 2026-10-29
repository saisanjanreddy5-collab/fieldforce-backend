import { pool } from "../config/db";
import { createLead, listLeadsForUser } from "../services/lead-service";
import { escalateToSlc, qualifyLead, sendToField, logCallDisposition } from "../services/lead-call-center-service";
import { getLeadsExportData, reconstructOwnerTrail } from "../services/lead-export-service";

// Verifies the world-class Leads export end to end: a lead walked through
// the real FLC -> SLC -> Qualified -> Field Sales funnel (via sendToField's
// no-pincode-coverage fallback path, since these test leads carry no
// pincode) must export with the correct FLC Handled By / SLC Handled By /
// Field Sales Executive columns, and its full call/remark/stage-change
// history must show up in the History sheet, cross-referenced by Lead #.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function nameOf(userId: string): Promise<string> {
  const result = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [userId]);
  return result.rows[0].name;
}

async function main(): Promise<void> {
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;
  const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'admin@fieldforce.local'");
  const adminId = admin.rows[0].id;

  // --- Unit test: reconstructOwnerTrail in isolation (no DB) ---
  const trail = reconstructOwnerTrail(
    [
      { action: "escalated", oldValue: "FLC · Alice", newValue: "SLC · Bob" },
      { action: "status_changed", oldValue: "SLC", newValue: "Qualified" },
      { action: "owner_reassigned", oldValue: "Bob", newValue: "Carol" },
    ],
    { status: "Qualified", ownerName: "Carol", ownerRole: "agent" }
  );
  assertEqual("Unit: FLC handled by backfilled from escalated.oldValue", trail.flcHandledBy, "Alice");
  assertEqual("Unit: SLC handled by set from escalated.newValue", trail.slcHandledBy, "Bob");
  assertEqual("Unit: Field Sales Executive from owner_reassigned while Qualified", trail.fieldSalesExecutive, "Carol");

  // --- Integration test: a lead walked through the real funnel ---
  const lead = await createLead(
    { fullName: "Export Test Full Funnel", phone: "9876500041" },
    cc1Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );
  await logCallDisposition(lead.id, { disposition: "Call Done And Interested", notes: "Genuinely interested" }, cc1Id);

  const afterEscalate = await escalateToSlc(lead.id, cc1Id);
  const slcOwnerId = afterEscalate.ownerId!;
  const slcOwnerName = await nameOf(slcOwnerId);

  await qualifyLead(lead.id, slcOwnerId);
  const afterSend = await sendToField(lead.id, slcOwnerId, undefined);
  const fieldOwnerId = afterSend.ownerId!;
  const fieldOwnerName = await nameOf(fieldOwnerId);

  // A second lead that never leaves FLC, to confirm "-" shows for stages never reached.
  const flcOnlyLead = await createLead(
    { fullName: "Export Test Still FLC", phone: "9876500042" },
    cc1Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );

  const exportData = await getLeadsExportData(adminId, { search: "Export Test" });
  const fullFunnelRow = exportData.leads.find((l) => l.id === lead.id);
  const flcOnlyRow = exportData.leads.find((l) => l.id === flcOnlyLead.id);

  assertTrue("Export includes the full-funnel lead", Boolean(fullFunnelRow));
  assertEqual("Full-funnel FLC Handled By", fullFunnelRow?.flcHandledBy, "CC Agent 1");
  assertEqual("Full-funnel SLC Handled By", fullFunnelRow?.slcHandledBy, slcOwnerName);
  assertEqual("Full-funnel Field Sales Executive", fullFunnelRow?.fieldSalesExecutive, fieldOwnerName);
  assertEqual("Full-funnel current owner role is agent", fullFunnelRow?.ownerRole, "agent");

  assertTrue("Export includes the still-FLC lead", Boolean(flcOnlyRow));
  assertEqual("Still-FLC lead's FLC Handled By", flcOnlyRow?.flcHandledBy, "CC Agent 1");
  assertEqual("Still-FLC lead's SLC Handled By (never reached)", flcOnlyRow?.slcHandledBy, "-");
  assertEqual("Still-FLC lead's Field Sales Executive (never reached)", flcOnlyRow?.fieldSalesExecutive, "-");

  const fullFunnelHistory = exportData.history.filter((h) => h.leadNumber === fullFunnelRow?.leadNumber);
  assertTrue("History sheet has entries for the full-funnel lead", fullFunnelHistory.length > 0);
  assertTrue(
    "History includes the logged call with its disposition",
    fullFunnelHistory.some((h) => h.kind === "Activity" && h.detail.includes("Call Done And Interested"))
  );
  assertTrue(
    "History includes the FLC->SLC escalation",
    fullFunnelHistory.some((h) => h.kind === "History" && h.detail.toLowerCase().includes("escalat"))
  );
  assertTrue(
    "History includes the field fallback assignment",
    fullFunnelHistory.some((h) => h.kind === "History" && h.detail.toLowerCase().includes("fallback"))
  );

  const paginated = await listLeadsForUser(adminId, { search: "Export Test", page: 1, limit: 100 });
  assertEqual("Export row count matches the list endpoint's total for the same filters", exportData.leads.length, paginated.total);

  // Call Center/Field Sales being unable to reach this at all is enforced at
  // the route layer (requirePermission("leads.export"), already admin/
  // manager-only in role-permission-service.ts - not re-tested here, same
  // reasoning as every other *-service.ts function: permission gating is
  // the route's job, scope/visibility is the service's job).

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM activity_comments WHERE activity_id IN (SELECT id FROM activities WHERE lead_id = ANY($1))", [
    [lead.id, flcOnlyLead.id],
  ]);
  await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1)", [[lead.id, flcOnlyLead.id]]);
  await pool.query("DELETE FROM activities WHERE lead_id = ANY($1)", [[lead.id, flcOnlyLead.id]]);
  await pool.query("DELETE FROM leads WHERE id = ANY($1)", [[lead.id, flcOnlyLead.id]]);

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
