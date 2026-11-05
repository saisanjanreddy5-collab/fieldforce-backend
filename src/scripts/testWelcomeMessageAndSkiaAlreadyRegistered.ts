import { pool } from "../config/db";
import { createLead, bulkImportLeads } from "../services/lead-service";
import { sendWelcomeMessageForLead } from "../services/whatsapp-service";
import { getActiveTemplateByKey } from "../services/message-template-service";
import { isAlreadyRegisteredMessage } from "../services/skia-fofo-service";
import { isWhatsappConfigured } from "../config/whatsapp";

// Covers WEB-005 (welcome_message_sent was a fully dead flag - nothing ever
// set or sent it) and WEB-015 (FOFO push surfaced SKIA's "already
// registered" rejection as a blind, confusing 502 even for the legitimate
// case of one owner's second franchise).
//
// WhatsApp is NOT configured in this environment (confirmed via
// isWhatsappConfigured()) - every assertion below is written to hold
// correctly either way, same adaptive-assertion style testFofoRepushGuard.ts
// already uses for SKIA FOFO (which IS genuinely configured here - this
// script never places a real request against either external integration).

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    const configured = isWhatsappConfigured();

    // --- The seed template exists and uses the expected token ---
    const template = await getActiveTemplateByKey("lead_welcome", "whatsapp");
    assertTrue("lead_welcome WhatsApp template seed exists and is active", template !== null);
    assertTrue("Template body uses the {{firstName}} token", (template ?? "").includes("{{firstName}}"));

    // --- Direct lead creation (manual/queue/QR/website path) ---
    const lead = await createLead({ fullName: "Welcome Message Test Lead", phone: "9876543210" }, testadminId, undefined, {});
    createdLeadIds.push(lead.id);
    if (configured) {
      assertTrue("Welcome message actually sent when WhatsApp is configured", lead.welcomeMessageSent === true);
    } else {
      assertTrue("Welcome message not sent when WhatsApp isn't configured, but lead creation still succeeded", lead.welcomeMessageSent === false);
    }

    // --- No phone on file - never even attempted ---
    const noPhoneLead = await createLead({ fullName: "No Phone Welcome Test" }, testadminId, undefined, {});
    createdLeadIds.push(noPhoneLead.id);
    assertTrue("A lead with no phone on file never gets welcome_message_sent set", noPhoneLead.welcomeMessageSent === false);

    // --- Bulk import must NEVER auto-send, regardless of WhatsApp config ---
    const bulkResult = await bulkImportLeads([{ fullName: "Welcome Message Bulk Test", phone: "9876500000" }], testadminId);
    assertEqual("Bulk import created the row", bulkResult.created, 1);
    const bulkRow = await pool.query<{ id: string; welcome_message_sent: boolean }>(
      "SELECT id, welcome_message_sent FROM leads WHERE full_name = $1",
      ["Welcome Message Bulk Test"]
    );
    createdLeadIds.push(bulkRow.rows[0].id);
    assertTrue(
      "Bulk-imported lead never gets an auto welcome message, even if WhatsApp is configured",
      bulkRow.rows[0].welcome_message_sent === false
    );

    // --- Never blocks the caller, under any configuration state ---
    let threw = false;
    try {
      await sendWelcomeMessageForLead(lead.id, "9876543210", "Edge Case", testadminId);
    } catch {
      threw = true;
    }
    assertTrue("sendWelcomeMessageForLead never throws - a WhatsApp outage/misconfiguration must never fail lead creation", !threw);

    // --- WEB-015: SKIA "already registered" heuristic, tested in isolation (no real network call) ---
    assertTrue("Detects SKIA's 'already registered' phrasing", isAlreadyRegisteredMessage("This phone number is already registered"));
    assertTrue("Detects 'already exists' phrasing too", isAlreadyRegisteredMessage("User already exists for this number"));
    assertTrue("Case-insensitive", isAlreadyRegisteredMessage("ALREADY REGISTERED"));
    assertTrue("A genuinely different/unrelated error is NOT misclassified as 'already registered'", !isAlreadyRegisteredMessage("Invalid phone number format"));
    assertTrue("An empty/unknown message is NOT misclassified either", !isAlreadyRegisteredMessage(""));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM whatsapp_messages WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM activities WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
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
