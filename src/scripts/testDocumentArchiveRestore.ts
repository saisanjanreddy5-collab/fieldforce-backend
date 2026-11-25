import { pool } from "../config/db";
import { createLead, getLeadTimeline } from "../services/lead-service";
import {
  saveUploadedFile,
  updateDocumentStatus,
  deleteDocumentFile,
  listDocuments,
  listArchivedDocuments,
  restoreArchivedDocument,
} from "../services/lead-document-service";

// Covers the client-reported gap: lead/FOFO documents already archived a
// removed or replaced file into lead_document_archive (real data, never
// unlinked from disk) - but nothing anywhere ever read that table back. No
// "what used to be here" view, no way to undo a mistaken remove/replace.
// Fixed with listArchivedDocuments (history for one lead+doc-type slot) and
// restoreArchivedDocument (pulls an old version back into the live slot,
// archiving whatever's currently live first so nothing is ever lost).

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

function fakeFile(path: string, originalname: string): Express.Multer.File {
  return { path, originalname } as Express.Multer.File;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    const lead = await createLead({ fullName: "Document Archive Restore Test" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);

    await saveUploadedFile(lead.id, "pan_card", fakeFile("/tmp/pan-v1.pdf", "pan-v1.pdf"), testadminId);
    await saveUploadedFile(lead.id, "pan_card", fakeFile("/tmp/pan-v2.pdf", "pan-v2.pdf"), testadminId);

    const historyAfterReplace = await listArchivedDocuments(lead.id, "pan_card");
    assertTrue("Replacing a document archives the old version", historyAfterReplace.length === 1);
    assertTrue("Archived entry is marked 'replaced'", historyAfterReplace[0]?.archivedReason === "replaced");
    assertTrue("Archived entry keeps the old filename", historyAfterReplace[0]?.originalFilename === "pan-v1.pdf");

    const liveBeforeDelete = await listDocuments(lead.id);
    const panDoc = liveBeforeDelete.find((d) => d.docType === "pan_card")!;
    assertTrue("Live slot currently has v2", panDoc.originalFilename === "pan-v2.pdf");

    await updateDocumentStatus(panDoc.id, "verified", undefined, testadminId);
    await deleteDocumentFile(panDoc.id, testadminId);
    const liveAfterDelete = await listDocuments(lead.id);
    assertTrue("Live slot is empty after deleting", !liveAfterDelete.find((d) => d.docType === "pan_card")!.hasFile);

    const historyAfterDelete = await listArchivedDocuments(lead.id, "pan_card");
    assertTrue("Deleting also logs to history - now 2 entries total", historyAfterDelete.length === 2);
    const v2Entry = historyAfterDelete.find((e) => e.originalFilename === "pan-v2.pdf");
    assertTrue("v2's entry is marked 'deleted'", v2Entry?.archivedReason === "deleted");

    const restored = await restoreArchivedDocument(v2Entry!.id, testadminId);
    assertTrue("Restoring brings the file back as the live document", restored.hasFile && restored.originalFilename === "pan-v2.pdf");

    const liveAfterRestore = await listDocuments(lead.id);
    assertTrue("Live slot reflects the restored file", liveAfterRestore.find((d) => d.docType === "pan_card")!.originalFilename === "pan-v2.pdf");

    const historyAfterRestore = await listArchivedDocuments(lead.id, "pan_card");
    assertTrue("History still has both old entries after a restore (nothing is removed from the log)", historyAfterRestore.length === 2);

    // Restoring v1 now (while v2 is live) must archive v2 first, not just overwrite it.
    const v1Entry = historyAfterRestore.find((e) => e.originalFilename === "pan-v1.pdf");
    await restoreArchivedDocument(v1Entry!.id, testadminId);
    const historyAfterSecondRestore = await listArchivedDocuments(lead.id, "pan_card");
    assertTrue(
      "Restoring a different version archives whatever was live first - 3 entries now",
      historyAfterSecondRestore.length === 3
    );
    const liveAfterSecondRestore = await listDocuments(lead.id);
    assertTrue(
      "Live slot now shows v1 again",
      liveAfterSecondRestore.find((d) => d.docType === "pan_card")!.originalFilename === "pan-v1.pdf"
    );

    // Every document action shows in the lead's History tab, by who did it.
    const timeline = await getLeadTimeline(lead.id, testadminId);
    const docEvents = timeline.filter((e) => e.kind === "audit" && e.event!.action.startsWith("document_")).map((e) => e.event!);
    const actions = docEvents.map((e) => e.action);
    assertTrue("History: lead created entry", timeline.some((e) => e.kind === "audit" && e.event!.action === "created"));
    assertTrue("History: upload logged", actions.includes("document_uploaded"));
    assertTrue("History: replace logged (pan-v1.pdf -> pan-v2.pdf)", docEvents.some((e) => e.action === "document_replaced" && e.oldValue === "pan-v1.pdf" && e.newValue === "pan-v2.pdf"));
    assertTrue("History: verify logged", docEvents.some((e) => e.action === "document_status_changed" && e.newValue === "Verified"));
    assertTrue("History: remove logged", actions.includes("document_removed"));
    assertTrue("History: both restores logged", actions.filter((a) => a === "document_restored").length === 2);
    assertTrue("History: every document entry names who did it", docEvents.every((e) => e.actorName !== null));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM lead_document_archive WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM lead_documents WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
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
