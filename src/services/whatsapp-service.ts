import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { WHATSAPP_BASE_URL, WHATSAPP_MEDIA_BASE_URL, isWhatsappConfigured } from "../config/whatsapp";
import { env } from "../config/env";
import { createActivityForLead } from "./activity-service";
import { getLeadById, findLeadIdByPhone, isLeadInOwnerScope } from "./lead-service";
import * as messageTemplateService from "./message-template-service";

interface SendMessageApiResponse {
  messages?: { id: string }[];
  error?: { message?: string };
}

interface WhatsappMessageRow {
  id: string;
  lead_id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  status: string;
  wa_message_id: string | null;
  sent_by: string | null;
  created_at: string;
  media_url: string | null;
  media_mime_type: string | null;
  media_file_name: string | null;
}

function toPublicMessage(row: WhatsappMessageRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    mediaUrl: row.media_url,
    mediaMimeType: row.media_mime_type,
    mediaFileName: row.media_file_name,
  };
}

// Same on-disk pattern as expense-service.ts/lead-document-service.ts -
// real files, random filename (the only thing standing between this public
// URL and anyone guessing it, see the public route's own comment).
const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads", "whatsapp-attachments");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const OUTBOUND_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 20)}`),
});

export const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: 16 * 1024 * 1024 }, // WhatsApp's own document/image cap
  fileFilter: (_req, file, cb) => {
    if (!OUTBOUND_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new ApiError(422, "That file type can't be sent over WhatsApp"));
      return;
    }
    cb(null, true);
  },
});

// filename always comes from a URL param on the public route below - never
// trust it as a raw path. path.basename strips any "../" a request could
// try to smuggle in, and resolving against UPLOAD_ROOT then re-checking the
// result still starts with UPLOAD_ROOT closes the one remaining escape
// (a filename that's itself an absolute path on some OS).
export function resolveAttachmentPath(filename: string): string {
  const resolved = path.join(UPLOAD_ROOT, path.basename(filename));
  if (!resolved.startsWith(UPLOAD_ROOT) || !fs.existsSync(resolved)) {
    throw new ApiError(404, "File not found");
  }
  return resolved;
}

function buildPublicMediaUrl(filename: string): string {
  return `${env.PUBLIC_BACKEND_BASE_URL}/api/public/whatsapp-media/${filename}`;
}

function assertConfigured(): void {
  if (!isWhatsappConfigured()) {
    throw new ApiError(503, "WhatsApp integration is not configured yet");
  }
}

// K3's documentation labels this header "api key" (with a space) in every
// example - but an HTTP header name can never actually contain a space
// (RFC 7230 field-name is a token, which excludes it), so that's just how
// they described it for readability in the PDF, not the literal wire name.
function requestHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: env.WHATSAPP_API_KEY!,
    wanumber: env.WHATSAPP_WANUMBER!,
  };
}

// The actual "send to K3 + log it" mechanics, shared by a human composing a
// message (sendTextMessage) and the system auto-sending a welcome message
// right after lead creation (sendWelcomeMessageForLead) - the latter has no
// requesting user to scope-check against (the creator's own insert already
// establishes access), so that check stays in sendTextMessage, not here.
async function postWhatsappMessage(leadId: string, phone: string, body: string, sentBy: string, activitySubject: string) {
  // Leads are entered as plain 10-digit Indian mobile numbers with no
  // country code (same assumption normalizePhone in lead-service.ts makes),
  // but WhatsApp's API needs the full international MSISDN - a bare
  // 10-digit number silently fails to actually deliver even though the API
  // accepts the request and returns a message id.
  const digits = phone.replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  const response = await fetch(`${WHATSAPP_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
  });

  const responseBody = (await response.json()) as SendMessageApiResponse;
  const waMessageId = responseBody.messages?.[0]?.id;

  if (!response.ok || !waMessageId) {
    throw new ApiError(502, `WhatsApp send failed: ${responseBody.error?.message ?? "unknown error"}`);
  }

  const result = await pool.query<WhatsappMessageRow>(
    `INSERT INTO whatsapp_messages (lead_id, direction, body, status, wa_message_id, sent_by)
     VALUES ($1, 'outbound', $2, 'sent', $3, $4)
     RETURNING *`,
    [leadId, body, waMessageId, sentBy]
  );

  // Same "log a real activity" convention as email (microsoft-service.ts)
  // and calls (smartflo-service.ts) - without this, a WhatsApp send was
  // invisible on the lead's Activity timeline and uncounted in any
  // activity-based stat, even though the message itself was really sent.
  await createActivityForLead(leadId, { type: "whatsapp", subject: activitySubject, status: "completed", details: { body } }, sentBy);

  return toPublicMessage(result.rows[0]);
}

export async function sendTextMessage(leadId: string, body: string, requestingUserId: string) {
  assertConfigured();

  // Strict owner-scope, not getLeadById's own broader visibility check - see
  // smartflo-service.ts's initiateCallForLead for the full reasoning.
  // listMessagesForLead below deliberately keeps the broader check (reading
  // past messages is a view, not an action).
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const lead = await getLeadById(leadId, requestingUserId);
  if (!lead.phone) {
    throw new ApiError(422, "This lead has no phone number on file");
  }

  return postWhatsappMessage(leadId, lead.phone, body, requestingUserId, "WhatsApp message");
}

// Shared by all three media senders below - same owner-scope + phone check
// sendTextMessage does, then the actual "send to K3 + log it" mechanics,
// parallel to postWhatsappMessage but for a file instead of plain text.
// K3's send API wants a real URL it can fetch (confirmed from their own
// docs - every media example uses "link", never a raw upload), so the file
// has to already be reachable at publicMediaUrl before this is called -
// the three exported functions below build that URL from the same request
// that received the upload, since nothing in this codebase tracks its own
// public base URL as a standing config value.
async function postWhatsappMediaMessage(
  leadId: string,
  phone: string,
  type: "image" | "video" | "document",
  mediaPayload: Record<string, unknown>,
  caption: string | null,
  publicMediaUrl: string,
  mimeType: string,
  originalFilename: string,
  sentBy: string,
  activitySubject: string
) {
  const digits = phone.replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  const response = await fetch(`${WHATSAPP_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type,
      [type]: mediaPayload,
    }),
  });

  const responseBody = (await response.json()) as SendMessageApiResponse;
  const waMessageId = responseBody.messages?.[0]?.id;

  if (!response.ok || !waMessageId) {
    throw new ApiError(502, `WhatsApp send failed: ${responseBody.error?.message ?? "unknown error"}`);
  }

  const result = await pool.query<WhatsappMessageRow>(
    `INSERT INTO whatsapp_messages (lead_id, direction, body, status, wa_message_id, sent_by, media_url, media_mime_type, media_file_name)
     VALUES ($1, 'outbound', $2, 'sent', $3, $4, $5, $6, $7)
     RETURNING *`,
    [leadId, caption, waMessageId, sentBy, publicMediaUrl, mimeType, originalFilename]
  );

  await createActivityForLead(
    leadId,
    { type: "whatsapp", subject: activitySubject, status: "completed", details: { body: caption ?? originalFilename } },
    sentBy
  );

  return toPublicMessage(result.rows[0]);
}

async function requireLeadPhoneInScope(leadId: string, requestingUserId: string): Promise<string> {
  assertConfigured();
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }
  const lead = await getLeadById(leadId, requestingUserId);
  if (!lead.phone) {
    throw new ApiError(422, "This lead has no phone number on file");
  }
  return lead.phone;
}

export async function sendImageMessage(
  leadId: string,
  storedFilename: string,
  mimeType: string,
  originalFilename: string,
  caption: string | null,
  requestingUserId: string
) {
  const phone = await requireLeadPhoneInScope(leadId, requestingUserId);
  const publicMediaUrl = buildPublicMediaUrl(storedFilename);
  return postWhatsappMediaMessage(
    leadId,
    phone,
    "image",
    caption ? { link: publicMediaUrl, caption } : { link: publicMediaUrl },
    caption,
    publicMediaUrl,
    mimeType,
    originalFilename,
    requestingUserId,
    "WhatsApp photo"
  );
}

export async function sendVideoMessage(
  leadId: string,
  storedFilename: string,
  mimeType: string,
  originalFilename: string,
  caption: string | null,
  requestingUserId: string
) {
  const phone = await requireLeadPhoneInScope(leadId, requestingUserId);
  const publicMediaUrl = buildPublicMediaUrl(storedFilename);
  return postWhatsappMediaMessage(
    leadId,
    phone,
    "video",
    caption ? { link: publicMediaUrl, caption } : { link: publicMediaUrl },
    caption,
    publicMediaUrl,
    mimeType,
    originalFilename,
    requestingUserId,
    "WhatsApp video"
  );
}

export async function sendDocumentMessage(
  leadId: string,
  storedFilename: string,
  mimeType: string,
  originalFilename: string,
  caption: string | null,
  requestingUserId: string
) {
  const phone = await requireLeadPhoneInScope(leadId, requestingUserId);
  const publicMediaUrl = buildPublicMediaUrl(storedFilename);
  return postWhatsappMediaMessage(
    leadId,
    phone,
    "document",
    caption ? { link: publicMediaUrl, filename: originalFilename, caption } : { link: publicMediaUrl, filename: originalFilename },
    caption,
    publicMediaUrl,
    mimeType,
    originalFilename,
    requestingUserId,
    "WhatsApp document"
  );
}

// Fire-and-forget from createLead right after insert (see its own call site)
// - never throws out to the caller, since a WhatsApp outage must never fail
// lead creation itself. Returns whether it actually sent, so createLead can
// flip welcome_message_sent only on a real success. "Not configured" is a
// silent no-op (plenty of deployments have no WhatsApp integration wired up
// at all), not a logged error - a real send failure still gets logged, since
// that one's worth knowing about.
export async function sendWelcomeMessageForLead(leadId: string, phone: string, fullName: string, creatorId: string): Promise<boolean> {
  if (!isWhatsappConfigured()) return false;
  try {
    const template = await messageTemplateService.getActiveTemplateByKey("lead_welcome", "whatsapp");
    if (!template) return false;
    const firstName = fullName.trim().split(" ")[0] || fullName.trim();
    const body = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key === "firstName" ? firstName : ""));
    await postWhatsappMessage(leadId, phone, body, creatorId, "Welcome message");
    return true;
  } catch (err) {
    console.error(`Welcome message failed for lead ${leadId}:`, err);
    return false;
  }
}

export async function listMessagesForLead(leadId: string, requestingUserId: string) {
  // getLeadById already throws (403/404) if this lead isn't visible to the
  // requesting user, so there's no separate visibility check needed here.
  await getLeadById(leadId, requestingUserId);

  const result = await pool.query<WhatsappMessageRow>(
    "SELECT * FROM whatsapp_messages WHERE lead_id = $1 ORDER BY created_at ASC",
    [leadId]
  );
  return result.rows.map(toPublicMessage);
}

// Fails closed, not open, when the secret isn't configured - this route has
// no requireAuth (K3/Pinbot's servers call it directly, see
// whatsapp-routes.ts), so the shared secret is the only thing standing
// between it and a fully anonymous POST that could inject fabricated
// messages tied to arbitrary leads. An unset secret means the integration
// isn't set up yet, not that it should be unguarded.
export function isWebhookSecretValid(providedSecret: string | undefined): boolean {
  if (!env.WHATSAPP_WEBHOOK_SECRET) return false;
  return providedSecret === env.WHATSAPP_WEBHOOK_SECRET;
}

// Best-effort shape based on Meta's public WhatsApp Cloud API webhook
// format. This provider's send-message API mirrors Meta's own Graph API
// almost field-for-field ("messaging_product", template component
// structure, etc.), which is the basis for assuming their webhook follows
// Meta's standard convention too - entry[].changes[].value.messages for an
// inbound message, .statuses for a delivery/read/failed update. Now
// confirmed against real K3 production traffic (not just Meta's public
// docs) - this shape is correct. The per-type sub-objects (image/video/
// document/audio) are confirmed straight from K3's own Cloud Callback API
// doc, not guessed.
interface InboundMedia {
  id: string;
  mime_type: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

interface WhatsappWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          id: string;
          from: string;
          type: string;
          text?: { body: string };
          image?: InboundMedia;
          video?: InboundMedia;
          document?: InboundMedia;
          audio?: InboundMedia;
        }[];
        statuses?: { id: string; status: string }[];
      };
    }[];
  }[];
}

// K3's own doc for this ("DOWNLOAD MEDIA") shows the response as the raw
// file bytes directly, not a JSON wrapper - confirmed from their example,
// not assumed. Saved under the same UPLOAD_ROOT as outbound attachments so
// both directions end up served by the exact same public route.
async function downloadInboundMediaToFile(mediaId: string, mimeType: string): Promise<{ filePath: string; publicFilename: string }> {
  const response = await fetch(`${WHATSAPP_MEDIA_BASE_URL}/downloadmedia/${mediaId}`, { headers: requestHeaders() });
  if (!response.ok) {
    throw new ApiError(502, `Failed to download WhatsApp media ${mediaId}`);
  }
  const extension = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  const publicFilename = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(UPLOAD_ROOT, publicFilename);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, publicFilename };
}

// How long a repeated wa_message_id is treated as the same delivery
// retried, not a genuinely new message that happens to reuse an old id.
// A real provider retry of the same event lands within seconds to
// minutes of the original; 10 minutes is generous headroom for that
// while still being nowhere near the days/weeks apart the real collision
// (two different real messages, confirmed in production data) turned out
// to span.
const DUPLICATE_DELIVERY_WINDOW = "10 minutes";

export async function handleWebhookEvent(payload: WhatsappWebhookPayload): Promise<void> {
  console.log("WhatsApp webhook payload:", JSON.stringify(payload));

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const inbound of change.value?.messages ?? []) {
        // Text, and every media type K3's own doc documents inbound
        // (image/video/document/audio - voice notes are just audio with
        // voice:true, same object shape). Anything else (location,
        // contacts, stickers, interactive replies) is left alone for now,
        // same as before - not silently mis-filed as a different type.
        const media = inbound.image ?? inbound.video ?? inbound.document ?? inbound.audio;
        if (inbound.type !== "text" && !media) continue;
        if (inbound.type === "text" && !inbound.text) continue;

        const leadId = await findLeadIdByPhone(inbound.from);
        if (!leadId) continue;

        // wa_message_id is not guaranteed unique forever in practice (see
        // model.ts's own comment on this table for the real incident this
        // traces back to) - a blind ON CONFLICT (wa_message_id) DO NOTHING
        // silently dropped every later message that happened to share an
        // id with one already in the table, no matter how long ago. This
        // only skips the insert when a same-id row is recent enough to be
        // a genuine retry of the same delivery.
        const recentDuplicate = await pool.query(
          `SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 AND created_at > now() - interval '${DUPLICATE_DELIVERY_WINDOW}'`,
          [inbound.id]
        );
        if ((recentDuplicate.rowCount ?? 0) > 0) continue;

        if (inbound.type === "text") {
          await pool.query(
            `INSERT INTO whatsapp_messages (lead_id, direction, body, status, wa_message_id)
             VALUES ($1, 'inbound', $2, 'received', $3)`,
            [leadId, inbound.text!.body, inbound.id]
          );
          continue;
        }

        // A download failure here must not lose the message entirely - it
        // still gets recorded (so the thread shows "a photo arrived"),
        // just without a working link, rather than vanishing like every
        // media message did before this whole branch existed.
        let mediaUrl: string | null = null;
        let mediaFileName: string | null = null;
        try {
          const { publicFilename } = await downloadInboundMediaToFile(media!.id, media!.mime_type);
          mediaUrl = buildPublicMediaUrl(publicFilename);
          mediaFileName = media!.filename ?? publicFilename;
        } catch (err) {
          console.error(`Failed to download inbound WhatsApp media ${media!.id}:`, err);
        }

        await pool.query(
          `INSERT INTO whatsapp_messages (lead_id, direction, body, status, wa_message_id, media_url, media_mime_type, media_file_name)
           VALUES ($1, 'inbound', $2, 'received', $3, $4, $5, $6)`,
          [leadId, media!.caption ?? null, inbound.id, mediaUrl, media!.mime_type, mediaFileName]
        );
      }

      for (const status of change.value?.statuses ?? []) {
        // Scoped to direction = 'outbound' - status updates (sent/
        // delivered/read) only ever apply to a message this app itself
        // sent, never to one it received. Without this, the same
        // wa_message_id reuse that broke inbound inserts above could also
        // make a stale status update land on an unrelated inbound row
        // that happens to share an old id.
        await pool.query("UPDATE whatsapp_messages SET status = $1 WHERE wa_message_id = $2 AND direction = 'outbound'", [
          status.status,
          status.id,
        ]);
      }
    }
  }
}
