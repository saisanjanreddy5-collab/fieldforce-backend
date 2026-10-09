import crypto from "crypto";
import { env } from "../config/env";
import { isFrappeConfigured } from "../config/frappe";
import { ApiError } from "../utils/ApiError";

// Thin wrapper around Frappe Helpdesk's REST API - this file only talks to
// Frappe over HTTP, it never touches our own database. support-ticket-service.ts
// is the layer that mirrors these calls into our own tables and enforces our
// own lead-visibility rules; keeping that split means this file can be
// verified against the real Frappe site in isolation.

function assertConfigured(): void {
  if (!isFrappeConfigured()) {
    throw new ApiError(503, "Frappe Helpdesk integration is not configured yet");
  }
}

// Frappe's token auth scheme - "Authorization: token <api_key>:<api_secret>",
// confirmed against our own Frappe Cloud site (not guessed): a request with
// this exact header shape returned the expected logged-in user.
function requestHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `token ${env.FRAPPE_API_KEY}:${env.FRAPPE_API_SECRET}`,
  };
}

// Frappe's standard framework error shape on a failed REST call - not
// Helpdesk-specific, this is how any Frappe site reports an exception back
// over the REST API. _server_messages is a JSON-encoded array of strings,
// each itself JSON (e.g. '[{"message": "...", "indicator": "red"}]'), kept
// as a raw string here since the structure is only ever used for its text.
//
// Confirmed the hard way, not guessed: a whitelisted method that raises an
// exception inside its own try/except (as reply_via_agent does around its
// email send) can still come back as HTTP 200 - the failure only shows up
// in _server_messages with raise_exception truthy. Checking response.ok
// alone missed this and reported a failed reply as a success.
interface FrappeServerMessage {
  message?: string;
  indicator?: string;
  raise_exception?: number | boolean;
}

interface FrappeErrorBody {
  exception?: string;
  exc_type?: string;
  _server_messages?: string;
}

function parseServerMessages(body: FrappeErrorBody): FrappeServerMessage[] {
  if (!body._server_messages) return [];
  try {
    const parsed = JSON.parse(body._server_messages) as string[];
    return parsed.map((entry) => JSON.parse(entry) as FrappeServerMessage);
  } catch {
    // Best-effort decode of a nested-JSON-in-JSON field - if it doesn't
    // parse, there's nothing more specific to extract from it.
    return [];
  }
}

// raise_exception is the only reliable signal that a message represents a
// real failure - frappe.msgprint can set indicator: "red" on a purely
// informational notice with no exception raised, so treating every red
// message as fatal would misreport a genuine success (e.g. a ticket that
// really was created) as a rejected request.
function findServerError(body: FrappeErrorBody): string | undefined {
  const messages = parseServerMessages(body);
  const errorMessage = messages.find((m) => m.raise_exception);
  return errorMessage?.message;
}

function describeFrappeError(body: FrappeErrorBody): string {
  return findServerError(body) ?? body.exception ?? "Unknown error from Frappe";
}

// Shared by every call below: POST to Frappe, and treat both an HTTP error
// and a 200-with-an-embedded-exception (see findServerError's comment) as a
// real failure. A response body that isn't even valid JSON is also a
// failure, never a silent success - a truncated/malformed 200 is not
// evidence the ticket or reply actually went through.
async function postToFrappe<T extends object>(path: string, payload: unknown, errorPrefix: string): Promise<T> {
  assertConfigured();

  const response = await fetch(`${env.FRAPPE_BASE_URL}${path}`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify(payload),
  });

  let body: T & FrappeErrorBody;
  try {
    body = (await response.json()) as T & FrappeErrorBody;
  } catch {
    throw new ApiError(502, `${errorPrefix}: Frappe returned a response that could not be read`);
  }

  if (!response.ok || findServerError(body)) {
    throw new ApiError(502, `${errorPrefix}: ${describeFrappeError(body)}`);
  }
  return body;
}

// The HD Ticket doctype's real field list, confirmed against Frappe
// Helpdesk's own hd_ticket.json (github.com/frappe/helpdesk) - only the
// fields this integration actually reads or writes, not the full ~70-field
// doctype. `status` is deliberately absent from the create payload: Frappe
// assigns it automatically via HD Ticket's own before_validate hook
// (set_default_status), so we never send one on creation, only read it back.
interface FrappeTicketResource {
  name: string;
  subject: string;
  status: string;
  raised_by: string | null;
}

export interface CreatedFrappeTicket {
  frappeTicketName: string;
  status: string;
}

export async function createTicketInFrappe(
  subject: string,
  description: string | undefined,
  raisedByEmail: string | undefined
): Promise<CreatedFrappeTicket> {
  const body = await postToFrappe<{ data?: FrappeTicketResource }>(
    "/api/resource/HD Ticket",
    { subject, description, raised_by: raisedByEmail },
    "Frappe rejected the ticket"
  );
  if (!body.data) {
    throw new ApiError(502, "Frappe rejected the ticket: no ticket data in the response");
  }

  return { frappeTicketName: body.data.name, status: body.data.status };
}

// Frappe Helpdesk's real agent-reply endpoint (helpdesk/api/ticket.py's
// bulk_reply, confirmed against the Helpdesk source) - it takes a list of
// ticket ids so one call can reply to several tickets at once, but we only
// ever pass a single id. Internally it calls the ticket document's own
// reply_via_agent(), which creates a real Communication record addressed to
// the ticket's raised_by - this is what actually sends the customer an
// email, not a side effect we need to replicate ourselves.
export async function replyToTicketInFrappe(frappeTicketName: string, message: string): Promise<void> {
  await postToFrappe(
    "/api/method/helpdesk.api.ticket.bulk_reply",
    { ticket_ids: [frappeTicketName], message },
    "Frappe rejected the reply"
  );
}

// Frappe's webhook signing scheme (confirmed against frappe/integrations/
// doctype/webhook/webhook.py, not guessed): base64(HMAC-SHA256(raw JSON
// body, the webhook's configured secret)), sent as X-Frappe-Webhook-Signature.
// Needs the exact raw bytes Frappe signed - see rawBody's definition in
// types/express.d.ts for why a re-serialized req.body can't be used here.
// Fails closed (false) whenever the secret isn't configured yet, same
// "unset means not set up, not unguarded" rule every other webhook secret in
// this codebase follows.
export function isWebhookSignatureValid(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  if (!env.FRAPPE_WEBHOOK_SECRET || !rawBody || !signatureHeader) return false;

  const expected = crypto.createHmac("sha256", env.FRAPPE_WEBHOOK_SECRET).update(rawBody).digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signatureHeader);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and an attacker-controlled header is exactly the input this
  // needs to be safe against.
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
