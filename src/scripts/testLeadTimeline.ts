import { pool } from "../config/db";
import { createLead, getLeadTimeline } from "../services/lead-service";
import { logCallDisposition, escalateToSlc } from "../services/lead-call-center-service";
import { addComment } from "../services/activity-service";

// Verifies the Lead Detail "History" tab's backing endpoint (getLeadTimeline):
// a call logged, a remark left on it, and a tier escalation must all show up
// merged into one feed, newest first, each one correctly attributed to the
// real person who did it - not just the underlying data existing somewhere.

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
    { fullName: "Lead Timeline Test", phone: "9876500031" },
    cc1Id,
    undefined,
    { requiresQualification: true, assignToCreator: true }
  );

  await logCallDisposition(lead.id, { disposition: "Call Done And Interested", notes: "Spoke to the customer, good sign" }, cc1Id);
  const activityRow = await pool.query<{ id: string }>(
    "SELECT id FROM activities WHERE lead_id = $1 AND type = 'call' ORDER BY created_at DESC LIMIT 1",
    [lead.id]
  );
  const activityId = activityRow.rows[0].id;

  await addComment(activityId, "Following up again tomorrow morning", cc1Id);
  await escalateToSlc(lead.id, cc1Id);

  const timeline = await getLeadTimeline(lead.id, cc1Id);

  assertEqual("Timeline has exactly 3 entries (call + remark + escalation)", timeline.length, 3);
  assertEqual("Newest entry is the escalation", timeline[0]?.kind, "audit");
  assertEqual("Escalation is attributed to the real actor", timeline[0]?.event?.actorName, cc1Name);
  assertEqual("Middle entry is the remark", timeline[1]?.kind, "comment");
  assertEqual("Remark text came through", timeline[1]?.comment?.comment, "Following up again tomorrow morning");
  assertEqual("Remark is attributed to the real actor", timeline[1]?.comment?.userName, cc1Name);
  assertEqual("Remark knows which activity it was left on", timeline[1]?.comment?.activityType, "call");
  assertEqual("Oldest entry is the call itself", timeline[2]?.kind, "activity");
  assertEqual("Call is attributed to the real actor", timeline[2]?.activity?.createdByName, cc1Name);
  assertEqual("Call's logged disposition came through", timeline[2]?.activity?.details.disposition, "Call Done And Interested");

  const dates = timeline.map((e) => new Date(e.date).getTime());
  assertTrue("Entries are sorted newest first", dates[0] >= dates[1] && dates[1] >= dates[2]);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  await pool.query("DELETE FROM activity_comments WHERE activity_id = $1", [activityId]);
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
