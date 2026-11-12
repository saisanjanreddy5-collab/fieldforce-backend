// TEMPORARY local-only seed - Activity Calendar had zero data to show, so
// there was nothing to verify the calendar UI/pagination against. Delete
// after verification, same as the other seedLocalDemoData* scripts.
import { pool } from "../config/db";
import { createActivityForLead, type ActivityInput } from "../services/activity-service";

const TESTADMIN_ID = "0c51c72e-1da5-4b17-8d0d-3ab11a321eea";

const TYPES: ActivityInput["type"][] = ["call", "email", "teams_meeting", "site_visit", "whatsapp", "internal"];
const SUBJECTS = [
  "Follow up on quote",
  "Discuss onboarding timeline",
  "Site visit for new store",
  "Check on payment status",
  "Weekly sync",
  "Send revised proposal",
  "Review franchise documents",
  "Confirm installation date",
];

function atHour(dayOffset: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  const leadsResult = await pool.query<{ id: string }>(`SELECT id FROM leads WHERE is_deleted = false ORDER BY lead_number LIMIT 20`);
  const leadIds = leadsResult.rows.map((r) => r.id);
  if (leadIds.length === 0) throw new Error("No leads found to attach activities to");

  // Spread across today, the rest of this week, and a couple of days last
  // week (as 'completed') so Day/Week/Month views and the overdue/done
  // counters all have something real to show.
  const schedule: { dayOffset: number; hour: number; status?: string }[] = [
    { dayOffset: 0, hour: 10 },
    { dayOffset: 0, hour: 14 },
    { dayOffset: 0, hour: 16, status: "completed" },
    { dayOffset: 1, hour: 9 },
    { dayOffset: 1, hour: 11 },
    { dayOffset: 1, hour: 15 },
    { dayOffset: 2, hour: 10 },
    { dayOffset: 2, hour: 13 },
    { dayOffset: 3, hour: 11 },
    { dayOffset: 3, hour: 17 },
    { dayOffset: 4, hour: 10 },
    { dayOffset: -1, hour: 10, status: "completed" },
    { dayOffset: -2, hour: 15, status: "completed" },
    { dayOffset: -3, hour: 9 }, // left pending + in the past -> overdue
    { dayOffset: 6, hour: 10 },
    { dayOffset: 10, hour: 11 },
    { dayOffset: 14, hour: 14 },
    { dayOffset: 20, hour: 10 },
  ];

  let count = 0;
  for (let i = 0; i < schedule.length; i++) {
    const { dayOffset, hour, status } = schedule[i];
    const type = TYPES[i % TYPES.length];
    const leadId = leadIds[i % leadIds.length];
    try {
      await createActivityForLead(
        leadId,
        {
          type,
          subject: SUBJECTS[i % SUBJECTS.length],
          dueDate: atHour(dayOffset, hour),
          status: status ?? "pending",
          assignedTo: TESTADMIN_ID,
        },
        TESTADMIN_ID
      );
      count++;
    } catch (e) {
      console.error(`Activity ${i + 1} failed:`, (e as Error).message);
    }
  }

  console.log(`Seeded ${count} activities for testadmin`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
