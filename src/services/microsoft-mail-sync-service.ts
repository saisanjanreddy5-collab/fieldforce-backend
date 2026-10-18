import { pool } from "../config/db";
import { GRAPH_BASE_URL } from "../config/microsoft";
import { getValidAccessToken } from "./microsoft-service";

// Mirrors Meta/WhatsApp's own inbound story in this codebase: sending has
// always worked because it only ever needed Mail.Send; nobody could see a
// reply because nothing ever asked for Mail.Read. Each connected mailbox is
// synced independently via Graph's delta-query mechanism (Microsoft's own
// recommended state-tracking pattern for mail) rather than a webhook
// subscription - this app has no background-job infrastructure to renew a
// subscription before its ~3-day expiry, and email reply visibility doesn't
// need WhatsApp's near-instant feel. A poll every few minutes (see
// startMailSyncScheduler) is the whole mechanism, nothing else to keep alive.
const DELTA_SELECT = "id,from,receivedDateTime,subject,bodyPreview";
const INITIAL_DELTA_URL = `${GRAPH_BASE_URL}/me/mailFolders('inbox')/messages/delta?$select=${DELTA_SELECT}&$top=50`;

interface GraphMessage {
  id: string;
  from?: { emailAddress?: { address?: string } };
  subject?: string;
  bodyPreview?: string;
}

interface DeltaPage {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

async function fetchDeltaPage(accessToken: string, url: string): Promise<DeltaPage> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Graph mail delta query failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as DeltaPage;
}

// Logs one inbound reply as the same kind of `activities` row an outbound
// email already produces (type='email'), just flagged `direction: 'inbound'`
// in `details` so the Activity/Logs tabs can tell them apart - no new table,
// no new tab, reusing exactly what already renders an email's body today.
// Matches purely by sender address against a lead's email on file, the same
// idea as WhatsApp's phone-number match. external_ref_id (the Graph message
// id) is the dedup key - Graph's delta query can legitimately redeliver a
// message id (e.g. its read state changed after we already logged it), and
// a resumed sync after a mid-page failure will naturally re-walk some
// already-seen messages too, so this has to be a real, checked guard, not
// just "shouldn't happen in practice".
async function matchAndLogInboundReply(connectedUserId: string, message: GraphMessage): Promise<boolean> {
  const fromAddress = message.from?.emailAddress?.address?.toLowerCase().trim();
  if (!fromAddress) return false;

  const existing = await pool.query("SELECT 1 FROM activities WHERE external_ref_id = $1 AND type = 'email'", [message.id]);
  if ((existing.rowCount ?? 0) > 0) return false;

  // Not every email landing in a connected salesperson's inbox is CRM-related
  // - only log the ones that are actually from a known lead's address.
  const leadMatch = await pool.query<{ id: string }>(
    "SELECT id FROM leads WHERE is_deleted = false AND lower(email) = $1 ORDER BY updated_at DESC LIMIT 1",
    [fromAddress]
  );
  const leadId = leadMatch.rows[0]?.id;
  if (!leadId) return false;

  await pool.query(
    `INSERT INTO activities (type, lead_id, assigned_to, subject, status, details, external_ref_id, created_by)
     VALUES ('email', $1, $2, $3, 'completed', $4::jsonb, $5, $2)`,
    [
      leadId,
      connectedUserId,
      message.subject ?? null,
      JSON.stringify({ body: message.bodyPreview ?? "", direction: "inbound" }),
      message.id,
    ]
  );
  return true;
}

async function saveDeltaLink(userId: string, deltaLink: string): Promise<void> {
  await pool.query("UPDATE microsoft_connections SET mail_delta_link = $1, updated_at = now() WHERE user_id = $2", [deltaLink, userId]);
}

// One mailbox's sync pass. With no stored checkpoint yet (a mailbox's first
// sync ever, or right after reconnecting since Mail.Read didn't exist
// before), this walks the *entire* current inbox just to reach the final
// page's deltaLink - deliberately without logging any of it as a "new"
// reply, since none of it is new, it's just however much mail already
// existed. Only once that baseline is established does a later pass's
// results mean "arrived since last time" and get matched/logged for real.
export async function syncMailboxForUser(userId: string, accessToken: string, storedDeltaLink: string | null): Promise<number> {
  const isInitialSync = !storedDeltaLink;
  let url = storedDeltaLink ?? INITIAL_DELTA_URL;
  let loggedCount = 0;

  while (true) {
    const page = await fetchDeltaPage(accessToken, url);

    if (!isInitialSync) {
      for (const message of page.value) {
        if (await matchAndLogInboundReply(userId, message)) loggedCount += 1;
      }
    }

    if (page["@odata.deltaLink"]) {
      await saveDeltaLink(userId, page["@odata.deltaLink"]);
      return loggedCount;
    }
    if (!page["@odata.nextLink"]) return loggedCount; // not expected per Graph's own contract, but never loop forever
    url = page["@odata.nextLink"];
  }
}

// The actual job body - every connected mailbox, one at a time, each
// failure isolated so one person's expired/revoked connection never blocks
// everyone else's sync. Called on a timer (see startMailSyncScheduler) and
// also once at boot, so a restart doesn't wait a full interval before the
// first catch-up pass.
export async function syncAllConnectedMailboxes(): Promise<void> {
  const connections = await pool.query<{ user_id: string; mail_delta_link: string | null }>(
    "SELECT user_id, mail_delta_link FROM microsoft_connections"
  );

  for (const row of connections.rows) {
    try {
      const accessToken = await getValidAccessToken(row.user_id);
      const logged = await syncMailboxForUser(row.user_id, accessToken, row.mail_delta_link);
      if (logged > 0) {
        console.log(`Mail sync: logged ${logged} inbound reply(ies) for user ${row.user_id}`);
      }
    } catch (err) {
      console.error(`Mail sync failed for user ${row.user_id}:`, err);
    }
  }
}

const SYNC_INTERVAL_MS = 3 * 60 * 1000;

// Deliberately a plain setInterval, not a new job-queue dependency - this is
// the one and only background job in this codebase today, and a single
// process-wide timer is the whole mechanism a project this size needs.
export function startMailSyncScheduler(): void {
  syncAllConnectedMailboxes().catch((err) => console.error("Initial mail sync failed:", err));
  setInterval(() => {
    syncAllConnectedMailboxes().catch((err) => console.error("Scheduled mail sync failed:", err));
  }, SYNC_INTERVAL_MS);
}
