import { pool } from "../config/db";
import { createLeadSchema } from "../validators/lead-validator";
import { getLeadById } from "../services/lead-service";
import * as qrCampaignService from "../services/qr-campaign-service";
import * as websiteLeadService from "../services/website-lead-service";
import { listTeamRequests, createLeaveRequest } from "../services/leave-service";

// Covers three more confirmed fixes from the bug sheet: PAN validation
// (missed in the first validation batch), Inquiry Category now actually
// getting set for QR/website-sourced leads (it was permanently blank -
// locked on the frontend, never written by either capture path), and Admin
// now seeing every employee's leave requests on the Team tab, not just
// requests from people who report to them directly (admin routinely has
// zero direct reports - see leave-service.ts's own comment).

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
  const managerRow = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'manager-under-a-globaltest@test.local'");
  const managerId = managerRow.rows[0].id;
  // A user who does NOT report to the test manager above, and does NOT
  // report to admin either (admin is never anyone's literal manager_id) -
  // proves the admin fix is a real global bypass, not an accident of who
  // happens to report to whom.
  const cc1Row = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1Row.rows[0].id;

  const createdLeadIds: string[] = [];
  const createdLeaveRequestIds: string[] = [];
  let campaignId: string | undefined;
  let websiteSourceId: string | undefined;

  try {
    // --- PAN validation ---
    // (phone included on every case below purely to satisfy the now-mandatory
    // phone field and isolate the actual thing each assertion is testing)
    assertTrue(
      "PAN rejects a garbage value",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", panNumber: "notapan" }).success
    );
    assertTrue(
      "PAN rejects a too-short value",
      !createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", panNumber: "ABCDE123F" }).success
    );
    assertTrue(
      "PAN accepts a real PAN",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", panNumber: "ABCDE1234F" }).success
    );
    const lowerCaseParsed = createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", panNumber: "abcde1234f" });
    assertTrue("PAN accepts lowercase input", lowerCaseParsed.success);
    if (lowerCaseParsed.success) {
      assertEqual("PAN is normalized to uppercase", lowerCaseParsed.data.panNumber, "ABCDE1234F");
    }
    assertTrue(
      "PAN still optional (blank is fine)",
      createLeadSchema.safeParse({ fullName: "X", phone: "9876543210", panNumber: "" }).success
    );

    // --- Inquiry Category: QR capture ---
    const campaign = await qrCampaignService.createCampaign(
      { name: "Batch2 Test QR Campaign", defaultCategory: "Retail", defaultOwnerId: testadminId },
      testadminId
    );
    campaignId = campaign.id;
    const qrResult = await qrCampaignService.submitPublicCapture(
      campaign.code!,
      { fullName: "Batch2 QR Lead", phone: "9876500061", cityOrPincode: "411001", consentGranted: true },
      undefined,
      "127.0.0.1"
    );
    const qrLeadRow = await pool.query<{ id: string }>("SELECT id FROM leads WHERE lead_number = $1", [qrResult.leadNumber]);
    createdLeadIds.push(qrLeadRow.rows[0].id);
    const qrLead = await getLeadById(qrLeadRow.rows[0].id, testadminId);
    assertEqual("QR-captured lead gets a real Inquiry Category", qrLead.inquiryCategory, "QR Code");
    assertTrue("QR-captured lead still gets its Inquiry Source too", (qrLead.inquirySource ?? "").includes("QR code"));

    // --- Inquiry Category: Website capture ---
    const source = await websiteLeadService.createWebsiteLeadSource(
      { name: "Batch2 Test Website Source", defaultCategory: "Retail", defaultOwnerId: testadminId },
      testadminId
    );
    websiteSourceId = source.id;
    const websiteResult = await websiteLeadService.submitWebsiteLead(
      source.apiKey!,
      { fullName: "Batch2 Website Lead", phone: "9876500062", consentGranted: true },
      "127.0.0.1"
    );
    const websiteLeadRow = await pool.query<{ id: string }>("SELECT id FROM leads WHERE lead_number = $1", [websiteResult.leadNumber]);
    createdLeadIds.push(websiteLeadRow.rows[0].id);
    const websiteLead = await getLeadById(websiteLeadRow.rows[0].id, testadminId);
    assertEqual("Website-captured lead gets a real Inquiry Category", websiteLead.inquiryCategory, "Website");
    assertTrue("Website-captured lead still gets its Inquiry Source too", (websiteLead.inquirySource ?? "").includes("Website"));

    // --- Admin leave visibility ---
    // listTeamRequests has always been scoped to "starts within the next 30
    // days" (unrelated to this fix) - pick a near date so that window never
    // accidentally excludes this request and produces a false failure here.
    const nearFutureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const leaveRequest = await createLeaveRequest(cc1Id, {
      kind: "casual",
      startDate: nearFutureDate,
      endDate: nearFutureDate,
      reason: "Batch2 admin-leave-visibility test",
    });
    createdLeaveRequestIds.push(leaveRequest.id);

    const adminTeamView = await listTeamRequests(testadminId, "admin");
    assertTrue(
      "Admin's Team tab now includes a request from someone who doesn't report to them at all",
      adminTeamView.some((r) => r.id === leaveRequest.id)
    );

    const managerTeamView = await listTeamRequests(managerId, "manager");
    assertTrue(
      "A regular manager's Team tab is UNCHANGED - still direct-reports-only, doesn't leak this unrelated request",
      !managerTeamView.some((r) => r.id === leaveRequest.id)
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeaveRequestIds.length > 0) {
      await pool.query("DELETE FROM leave_requests WHERE id = ANY($1::uuid[])", [createdLeaveRequestIds]);
    }
    if (createdLeadIds.length > 0) {
      await pool.query("DELETE FROM consents WHERE lead_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM audit_log WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])", [createdLeadIds]);
      await pool.query("DELETE FROM leads WHERE id = ANY($1::uuid[])", [createdLeadIds]);
    }
    if (campaignId) {
      await pool.query("DELETE FROM campaigns WHERE id = $1", [campaignId]);
    }
    if (websiteSourceId) {
      await pool.query("DELETE FROM campaigns WHERE id = $1", [websiteSourceId]);
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
