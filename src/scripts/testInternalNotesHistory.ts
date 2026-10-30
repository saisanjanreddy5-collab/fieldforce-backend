import { pool } from "../config/db";
import { createLead, updateLead, getLeadTimeline } from "../services/lead-service";
import { getLeadsExportData } from "../services/lead-export-service";

// Verifies the fix for the client's "Internal notes should be displayed
// within the lead's history" requirement: editing Internal Notes/RM Remark/
// LG Remark now writes a real, dated, attributed audit event (unlike before,
// where these were plain mutable text with no trail at all), and that event
// shows up in both getLeadTimeline (the History tab) and the Leads export's
// History sheet - the same two places every other kind of history entry
// already reaches.

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

async function main(): Promise<void> {
  const cc1 = await pool.query<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;
  const cc1Name = cc1.rows[0].name;

  const lead = await createLead(
    { fullName: "Internal Notes History Test", phone: "9876500071" },
    cc1Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );

  await updateLead(lead.id, { internalNotes: "First internal note" }, cc1Id);
  await updateLead(lead.id, { rmRemark: "RM should call back Friday" }, cc1Id);
  // Editing the same field twice must produce two real events, not one
  // overwritten entry - the whole point of this fix is a real trail.
  await updateLead(lead.id, { internalNotes: "Updated internal note" }, cc1Id);
  // Re-saving the exact same value must NOT produce a redundant event.
  await updateLead(lead.id, { internalNotes: "Updated internal note" }, cc1Id);

  const timeline = await getLeadTimeline(lead.id, cc1Id);
  const noteEvents = timeline.filter(
    (e) => e.kind === "audit" && ["internal_notes_updated", "rm_remark_updated", "lg_remark_updated"].includes(e.event!.action)
  );
  assertEqual("Exactly 3 real note-change events (no duplicate for the unchanged re-save)", noteEvents.length, 3);

  const internalNotesEvents = noteEvents.filter((e) => e.event!.action === "internal_notes_updated");
  assertEqual("Two internal_notes_updated events (two real edits)", internalNotesEvents.length, 2);
  assertEqual("Newest internal_notes_updated has the final value", internalNotesEvents[0].event!.newValue, "Updated internal note");
  assertEqual("Newest internal_notes_updated's old value is the first note", internalNotesEvents[0].event!.oldValue, "First internal note");
  assertEqual("Note-change event is attributed to the real actor", internalNotesEvents[0].event!.actorName, cc1Name);

  const rmRemarkEvent = noteEvents.find((e) => e.event!.action === "rm_remark_updated");
  assertTrue("rm_remark_updated event exists", Boolean(rmRemarkEvent));
  assertEqual("rm_remark_updated has the right text", rmRemarkEvent?.event!.newValue, "RM should call back Friday");

  const exportData = await getLeadsExportData(cc1Id, { search: "Internal Notes History Test" });
  const exportedLead = exportData.leads.find((l) => l.id === lead.id);
  assertEqual("Export's current Internal Notes column has the final value", exportedLead?.internalNotes, "Updated internal note");
  assertEqual("Export's current RM Remark column has the right value", exportedLead?.rmRemark, "RM should call back Friday");

  const exportHistory = exportData.history.filter((h) => h.leadNumber === exportedLead?.leadNumber && h.kind === "History");
  assertTrue(
    "Export's History sheet includes a note-change row",
    exportHistory.some((h) => h.detail.toLowerCase().includes("internal notes updated"))
  );

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = $1", [lead.id]);
  await pool.query("DELETE FROM activities WHERE lead_id = $1", [lead.id]);
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
