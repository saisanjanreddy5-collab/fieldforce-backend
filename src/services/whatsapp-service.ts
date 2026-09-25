import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { WHATSAPP_BASE_URL, isWhatsappConfigured } from "../config/whatsapp";
import { env } from "../config/env";
import { getLeadById, findLeadIdByPhone } from "./lead-service";

interface SendMessageApiResponse {
  messages?: { id: string }[];
  error?: { message?: string };
}

interface WhatsappMessageRow {
  id: string;
  lead_id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  wa_message_id: string | null;
  sent_by: string | null;
  created_at: string;
}

function toPublicMessage(row: WhatsappMessageRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  };
}

function assertConfigured(): void {
  if (!isWhatsappConfigured()) {
    throw new ApiError(503, "WhatsApp integration is not configured yet");
  }
}

function requestHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "api key": env.WHATSAPP_API_KEY!,
    wanumber: env.WHATSAPP_WANUMBER!,
  };
}

export async function sendTextMessage(leadId: string, body: string, requestingUserId: string) {
  assertConfigured();

  const lead = await getLeadById(leadId, requestingUserId);
  if (!lead.phone) {
    throw new ApiError(422, "This lead has no phone number on file");
  }

  const to = lead.phone.replace(/\D/g, "");
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
    [leadId, body, waMessageId, requestingUserId]
  );

  return toPublicMessage(result.rows[0]);
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

export function isWebhookSecretValid(providedSecret: string | undefined): boolean {
  if (!env.WHATSAPP_WEBHOOK_SECRET) return true;
  return providedSecret === env.WHATSAPP_WEBHOOK_SECRET;
}

// Best-effort shape based on Meta's public WhatsApp Cloud API webhook
// format. This provider's send-message API mirrors Meta's own Graph API
// almost field-for-field ("messaging_product", template component
// structure, etc.), which is the basis for assuming their webhook follows
// Meta's standard convention too - entry[].changes[].value.messages for an
// inbound message, .statuses for a delivery/read/failed update. Not
// confirmed against a real K3 payload yet; the raw body is logged on every
// call specifically so a mismatch is easy to spot and fix once this is live.
interface WhatsappWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: { id: string; from: string; type: string; text?: { body: string } }[];
        statuses?: { id: string; status: string }[];
      };
    }[];
  }[];
}

export async function handleWebhookEvent(payload: WhatsappWebhookPayload): Promise<void> {
  console.log("WhatsApp webhook payload:", JSON.stringify(payload));

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const inbound of change.value?.messages ?? []) {
        if (inbound.type !== "text" || !inbound.text) continue;

        const leadId = await findLeadIdByPhone(inbound.from);
        if (!leadId) continue;

        await pool.query(
          `INSERT INTO whatsapp_messages (lead_id, direction, body, status, wa_message_id)
           VALUES ($1, 'inbound', $2, 'received', $3)
           ON CONFLICT (wa_message_id) DO NOTHING`,
          [leadId, inbound.text.body, inbound.id]
        );
      }

      for (const status of change.value?.statuses ?? []) {
        await pool.query("UPDATE whatsapp_messages SET status = $1 WHERE wa_message_id = $2", [
          status.status,
          status.id,
        ]);
      }
    }
  }
}
