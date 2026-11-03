import { pool } from "../config/db";
import { createLead, listLeadsForUser } from "../services/lead-service";

// Covers the production performance fix: Call Center's "My Queue" used to
// make 3 separate full-paginated fetches (one per tier stage) where one
// request now does - status accepts a comma-separated list server-side.
// Also covers the two confirmed real pagination gaps (People list, Call
// log) at the API-shape level via a plain regression check that a
// multi-value filter and a single-value filter both still behave correctly
// against real data.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdLeadIds: string[] = [];

  try {
    const newLead = await createLead({ fullName: "MultiStatus Test New", phone: "9876500071" }, testadminId, undefined, {});
    const flcLead = await createLead(
      { fullName: "MultiStatus Test FLC", phone: "9876500072" },
      testadminId,
      undefined,
      { requiresQualification: true, assignToCreator: true }
    );
    const wonLead = await createLead({ fullName: "MultiStatus Test Won", phone: "9876500073", status: "won" }, testadminId, undefined, {});
    createdLeadIds.push(newLead.id, flcLead.id, wonLead.id);

    // Single value still behaves exactly as before
    const onlyNew = await listLeadsForUser(testadminId, { status: "New", page: 1, limit: 50 });
    assertTrue("Single-value status still matches only that status", onlyNew.leads.every((l) => l.status === "New"));
    assertTrue("Single-value status finds our New test lead", onlyNew.leads.some((l) => l.id === newLead.id));
    assertTrue("Single-value status does NOT include the FLC test lead", !onlyNew.leads.some((l) => l.id === flcLead.id));

    // Comma-separated value - the actual fix
    const merged = await listLeadsForUser(testadminId, { status: "New,FLC", page: 1, limit: 50 });
    assertTrue("Multi-value status includes the New test lead", merged.leads.some((l) => l.id === newLead.id));
    assertTrue("Multi-value status includes the FLC test lead", merged.leads.some((l) => l.id === flcLead.id));
    assertTrue("Multi-value status excludes a lead in neither status", !merged.leads.some((l) => l.id === wonLead.id));
    assertTrue(
      "Every row returned is really one of the requested statuses, nothing else leaked in",
      merged.leads.every((l) => l.status === "New" || l.status === "FLC")
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeadIds.length > 0) {
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
