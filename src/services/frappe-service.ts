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

function findServerError(body: FrappeErrorBody): string | undefined {
  const messages = parseServerMessages(body);
  const errorMessage = messages.find((m) => m.raise_exception || m.indicator === "red");
  return errorMessage?.message;
}

function describeFrappeError(body: FrappeErrorBody): string {
  return findServerError(body) ?? body.exception ?? "Unknown error from Frappe";
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
  assertConfigured();

  const response = await fetch(`${env.FRAPPE_BASE_URL}/api/resource/HD Ticket`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      subject,
      description,
      raised_by: raisedByEmail,
    }),
  });

  const body = (await response.json()) as { data?: FrappeTicketResource } & FrappeErrorBody;
  if (!response.ok || !body.data || findServerError(body)) {
    throw new ApiError(502, `Frappe rejected the ticket: ${describeFrappeError(body)}`);
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
  assertConfigured();

  const response = await fetch(`${env.FRAPPE_BASE_URL}/api/method/helpdesk.api.ticket.bulk_reply`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      ticket_ids: [frappeTicketName],
      message,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as FrappeErrorBody;
  if (!response.ok || findServerError(body)) {
    throw new ApiError(502, `Frappe rejected the reply: ${describeFrappeError(body)}`);
  }
}
