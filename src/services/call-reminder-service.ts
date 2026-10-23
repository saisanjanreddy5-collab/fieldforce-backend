import { pool } from "../config/db";
import { GRAPH_BASE_URL } from "../config/microsoft";
import { getValidAccessToken } from "./microsoft-service";

// Reminds a Call Center/Field employee by email, via their own connected
// Microsoft 365 account, when a scheduled call (CallCenterStageActions.tsx's
// "Call Back" flow, or any other scheduled call Activity - see
// activities.type='call') comes due - the actual fix for "I scheduled a
// callback and then forgot about it", not just a passive list nobody's
// nudged to check. Polled on a timer (see startCallReminderScheduler),
// same shape as microsoft-mail-sync-service.ts's own scheduler - this
// codebase's one established pattern for a recurring background job.
interface DueCallRow {
  id: string;
  due_date: string;
  lead_full_name: string;
  lead_phone: string | null;
  assigned_to: string;
  rep_email: string;
  rep_name: string;
}

async function sendReminderEmail(row: DueCallRow): Promise<void> {
  const accessToken = await getValidAccessToken(row.assigned_to);
  const when = new Date(row.due_date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const phoneLine = row.lead_phone ? `Phone: ${row.lead_phone}` : "No phone number on file";

  const response = await fetch(`${GRAPH_BASE_URL}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: `Call back reminder - ${row.lead_full_name}`,
        body: {
          contentType: "Text",
          content: `Hi ${row.rep_name},\n\nThis is your reminder to call back ${row.lead_full_name}, scheduled for ${when}.\n${phoneLine}\n\nOpen FieldForce to log the outcome once you've called.`,
        },
        toRecipients: [{ emailAddress: { address: row.rep_email } }],
      },
      saveToSentItems: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Graph sendMail failed (${response.status}): ${await response.text()}`);
  }
}

// The actual job body - every call reminder currently due, one at a time,
// each failure isolated so one person's expired/missing Microsoft
// connection never blocks everyone else's reminder (same isolation
// microsoft-mail-sync-service.ts's syncAllConnectedMailboxes already
// established). due_date > now() - interval '1 day' deliberately excludes
// anything older than a day overdue - a callback someone never acted on
// last week shouldn't suddenly email-bomb them the moment this feature
// ships; it's a timely nudge, not a backlog alarm.
export async function sendDueCallReminders(): Promise<void> {
  const result = await pool.query<DueCallRow>(
    `SELECT a.id, a.due_date, l.full_name AS lead_full_name, l.phone AS lead_phone,
       a.assigned_to, mc.ms_account_email AS rep_email, u.name AS rep_name
     FROM activities a
     JOIN leads l ON l.id = a.lead_id
     JOIN users u ON u.id = a.assigned_to
     -- INNER, not LEFT - mc.ms_account_email is the real, deliverable
     -- mailbox address (captured at OAuth connect time). users.email is
     -- this app's own login identity, which is very often a placeholder
     -- like admin@fieldforce.local that was never meant to be a real
     -- address - using it as the "to" sent a reminder nowhere and bounced
     -- (confirmed: a real test send came back "550 5.4.310 DNS domain
     -- fieldforce.local does not exist"). A rep with no Microsoft
     -- connection has nowhere to send this to at all, so they're correctly
     -- excluded here rather than failing per-row inside the try/catch below.
     JOIN microsoft_connections mc ON mc.user_id = a.assigned_to
     WHERE a.type = 'call'
       AND a.status <> 'completed'
       AND a.reminder_sent_at IS NULL
       AND a.due_date IS NOT NULL
       AND a.due_date <= now()
       AND a.due_date > now() - interval '1 day'
       AND l.is_deleted = false`
  );

  for (const row of result.rows) {
    try {
      await sendReminderEmail(row);
    } catch (err) {
      // The join above already excludes anyone with no Microsoft connection
      // at all - what lands here is a connected rep whose refresh token has
      // since expired/been revoked, or a transient Graph error. Marked sent
      // regardless (below) either way, so a stuck connection doesn't get
      // retried forever on every poll - the queue panel itself is still
      // there as the fallback once they do open the app.
      console.error(`Call reminder failed for activity ${row.id}:`, err instanceof Error ? err.message : err);
    }
    await pool.query("UPDATE activities SET reminder_sent_at = now() WHERE id = $1", [row.id]);
  }
}

const REMINDER_INTERVAL_MS = 2 * 60 * 1000;

// Deliberately a plain setInterval, matching microsoft-mail-sync-service.ts's
// own startMailSyncScheduler - this app's one established pattern for a
// recurring background job, not a new job-queue dependency for a second one.
export function startCallReminderScheduler(): void {
  sendDueCallReminders().catch((err) => console.error("Initial call reminder pass failed:", err));
  setInterval(() => {
    sendDueCallReminders().catch((err) => console.error("Scheduled call reminder pass failed:", err));
  }, REMINDER_INTERVAL_MS);
}
