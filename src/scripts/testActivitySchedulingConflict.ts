import { pool } from "../config/db";
import { createLead } from "../services/lead-service";
import { createActivityForLead, deleteActivity } from "../services/activity-service";

// Covers the client-reported bug: the system let activities be created for
// different users against the SAME lead at the SAME date/time, with zero
// validation - two field reps both getting assigned to visit the same
// client at the same hour, nobody finding out until they bump into each
// other at the door. Fixed in activity-service.ts's insertActivity via
// assertNoSchedulingConflict: same lead + same activity type + within a
// 15-minute window + still active (not completed/cancelled) now blocks the
// second create with a clear 409.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;
  const cc1 = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    const leadA = await createLead({ fullName: "Scheduling Conflict Test - Lead A" }, testadminId, undefined, {});
    createdLeadIds.push(leadA.id);
    const leadB = await createLead({ fullName: "Scheduling Conflict Test - Lead B" }, testadminId, undefined, {});
    createdLeadIds.push(leadB.id);

    const baseTime = new Date("2026-12-01T10:00:00.000Z");
    const iso = (offsetMinutes: number) => new Date(baseTime.getTime() + offsetMinutes * 60_000).toISOString();

    // 1. First site visit on Lead A at 10:00, assigned to testadmin.
    const first = await createActivityForLead(
      leadA.id,
      { type: "site_visit", subject: "Initial visit", dueDate: iso(0), assignedTo: testadminId },
      testadminId
    );

    // 2. A SECOND site visit on the SAME lead at 10:10 (within the 15-min
    // window), assigned to a DIFFERENT user - this is exactly the reported
    // bug and must now be rejected.
    let blockedCloseOverlap = false;
    let blockedMessage = "";
    try {
      await createActivityForLead(
        leadA.id,
        { type: "site_visit", subject: "Duplicate visit", dueDate: iso(10), assignedTo: cc1Id },
        testadminId
      );
    } catch (err) {
      blockedCloseOverlap = true;
      blockedMessage = err instanceof Error ? err.message : String(err);
    }
    assertTrue("A second site visit 10 minutes later on the same lead is rejected", blockedCloseOverlap);
    assertTrue("...rejection message names the conflicting time", blockedMessage.toLowerCase().includes("already has a"));

    // 3. A site visit far enough outside the window (30 min later) on the
    // same lead is a legitimate separate follow-up and must succeed.
    const farEnough = await createActivityForLead(
      leadA.id,
      { type: "site_visit", subject: "Follow-up visit", dueDate: iso(30), assignedTo: cc1Id },
      testadminId
    );
    assertTrue("A site visit 30 minutes later on the same lead is allowed (outside the window)", Boolean(farEnough.id));

    // 4. A DIFFERENT activity type at the exact same conflicting time is a
    // different channel, not a double-booking, and must succeed.
    const differentType = await createActivityForLead(
      leadA.id,
      { type: "call", subject: "Quick call", dueDate: iso(5), assignedTo: cc1Id },
      testadminId
    );
    assertTrue("A different activity type at the same time on the same lead is allowed", Boolean(differentType.id));

    // 5. The exact same time slot on a DIFFERENT lead is unrelated and must
    // succeed - the check is scoped per lead, not global.
    const otherLead = await createActivityForLead(
      leadB.id,
      { type: "site_visit", subject: "Visit on a different lead", dueDate: iso(0), assignedTo: cc1Id },
      testadminId
    );
    assertTrue("The same time slot on a different lead is allowed", Boolean(otherLead.id));

    // 6. Once the original activity is archived (deleteActivity soft-deletes
    // it), it no longer occupies the slot, so the same time now succeeds.
    await deleteActivity(first.id, testadminId);
    const afterCancel = await createActivityForLead(
      leadA.id,
      { type: "site_visit", subject: "Re-scheduled visit", dueDate: iso(0), assignedTo: cc1Id },
      testadminId
    );
    assertTrue("The same slot is free again once the original activity is archived", Boolean(afterCancel.id));

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
      await pool.query(
        "DELETE FROM activity_comments WHERE activity_id IN (SELECT id FROM activities WHERE lead_id = ANY($1::uuid[]))",
        [createdLeadIds]
      );
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
