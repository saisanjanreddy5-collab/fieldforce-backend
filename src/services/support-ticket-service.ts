import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { convert } from "html-to-text";
import { getLeadById } from "./lead-service";
import { createActivityForLead } from "./activity-service";
import * as frappeService from "./frappe-service";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../validators/support-ticket-validator";

// Same hierarchy-visibility rule leads themselves use (owner in the
// requesting user's subtree, or shared with them directly) - a ticket is
// never visible to someone who couldn't see its underlying lead. Kept as its
// own local copy rather than imported from lead-service.ts, matching how
// expense-service.ts/leave-service.ts/activity-service.ts each keep their
// own copy of this CTE rather than sharing one central definition.
const TICKET_VISIBILITY_SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

const TERMINAL_TICKET_STATUSES = ["Resolved", "Closed"];

interface SupportTicketRow {
  id: string;
  lead_id: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  frappe_ticket_name: string | null;
  created_by: string | null;
  assigned_to: string | null;
  response_by: string | null;
  resolution_by: string | null;
  created_at: string;
  updated_at: string;
  // Only present on queries that join leads/users for display purposes
  // (same split quote-service.ts uses) - undefined, not null, when a query
  // doesn't select them, so toPublicTicket can tell "not joined" apart from
  // "joined but genuinely has no name".
  lead_full_name?: string;
  created_by_name?: string | null;
  assigned_to_name?: string | null;
  // Whether at least one outbound reply exists - whether "first response"
  // was actually met, not just whether time has passed. Undefined, not
  // false, when a query doesn't join it (same "not joined" convention as
  // the name fields above) - toPublicTicket treats that as "unknown",
  // never defaults it to breached.
  has_responded?: boolean;
}

// Computed here, not stored - same reasoning invoice-service.ts's own
// isOverdue already uses: a deadline passing is a fact about the current
// moment, not the ticket row, so storing a stale "breached" boolean would
// drift the instant time moves on without anyone touching the ticket.
// responseBreached only cares whether a reply was ever sent, regardless of
// current status; resolutionBreached only cares whether the ticket reached
// a terminal status, regardless of replies - these are two independent
// promises, not one "is this ticket late" flag.
function toPublicTicket(row: SupportTicketRow) {
  const now = Date.now();
  const responseBreached =
    row.response_by !== null && row.has_responded === false && new Date(row.response_by).getTime() < now;
  const resolutionBreached =
    row.resolution_by !== null && !TERMINAL_TICKET_STATUSES.includes(row.status) && new Date(row.resolution_by).getTime() < now;

  return {
    id: row.id,
    leadId: row.lead_id,
    leadFullName: row.lead_full_name ?? null,
    subject: row.subject,
    description: row.description,
    status: row.status,
    priority: row.priority,
    frappeTicketName: row.frappe_ticket_name,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name ?? null,
    responseBy: row.response_by,
    resolutionBy: row.resolution_by,
    responseBreached,
    resolutionBreached,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SupportTicketMessageRow {
  id: string;
  ticket_id: string;
  direction: "inbound" | "outbound";
  body: string;
  sent_by: string | null;
  created_at: string;
}

function toPublicMessage(row: SupportTicketMessageRow) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    direction: row.direction,
    body: row.body,
    sentBy: row.sent_by,
    createdAt: row.created_at,
  };
}

export interface ListSupportTicketsFilters {
  leadId?: string;
  assignedTo?: string;
  page: number;
  limit: number;
}

// Mirrors listLeadsForUser's own scoping (lead owner in my subtree, or
// shared with me) by joining into leads rather than re-deriving a separate
// access model for tickets - a ticket can never be visible here unless its
// lead already would be.
export async function listSupportTickets(requestingUserId: string, filters: ListSupportTicketsFilters) {
  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const conditions = [
    "l.is_deleted = false",
    // Matches lead-service.ts's isLeadVisibleToUser exactly (subtree, shares,
    // and the same unconditional admin bypass) - without the last clause, a
    // ticket on a lead outside this admin's own subtree (including an
    // unowned one) would silently disappear from this top-level listing even
    // though GET /leads/:id/support-tickets would show it fine for the same
    // admin.
    `(l.owner_id IN (SELECT id FROM subtree)
      OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
      OR EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin'))`,
  ];
  const params: unknown[] = [requestingUserId];

  if (filters.leadId) {
    params.push(filters.leadId);
    conditions.push(`t.lead_id = $${params.length}`);
  }
  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`t.assigned_to = $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query<{ count: string }>(
    `${TICKET_VISIBILITY_SUBTREE_CTE}
     SELECT COUNT(*) FROM support_tickets t
     INNER JOIN leads l ON l.id = t.lead_id
     WHERE ${whereClause}`,
    params
  );

  const limitParamIndex = params.length + 1;
  const offsetParamIndex = params.length + 2;
  // Same l.full_name/u.name enrichment quote-service.ts's own list query
  // uses, so the frontend never has to separately look up a lead's name
  // just to show who a ticket belongs to. assignee needs its own join
  // alias since created_by already uses `u`.
  const result = await pool.query<SupportTicketRow>(
    `${TICKET_VISIBILITY_SUBTREE_CTE}
     SELECT t.*, l.full_name AS lead_full_name, u.name AS created_by_name, au.name AS assigned_to_name,
       EXISTS (SELECT 1 FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.direction = 'outbound') AS has_responded
     FROM support_tickets t
     INNER JOIN leads l ON l.id = t.lead_id
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN users au ON au.id = t.assigned_to
     WHERE ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    [...params, limit, offset]
  );

  return { supportTickets: result.rows.map(toPublicTicket), total: Number(countResult.rows[0].count) };
}

export async function createTicketForLead(
  leadId: string,
  subject: string,
  description: string | undefined,
  priority: string,
  requestingUserId: string
) {
  // Throws 403/404 on its own if this lead isn't visible/doesn't exist -
  // also gives us the lead's email to hand Frappe as raised_by.
  const lead = await getLeadById(leadId, requestingUserId);

  // `||`, not `??` - a lead with email set to "" (not null) must still be
  // treated as "no email", same as it would be for any other falsy-but-not-
  // nullish value here.
  const frappeTicket = await frappeService.createTicketInFrappe(subject, description, lead.email || undefined, priority);

  const result = await pool.query<SupportTicketRow>(
    `INSERT INTO support_tickets (lead_id, subject, description, status, priority, frappe_ticket_name, created_by, response_by, resolution_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      leadId,
      subject,
      description ?? null,
      frappeTicket.status,
      frappeTicket.priority ?? priority,
      frappeTicket.frappeTicketName,
      requestingUserId,
      frappeTicket.responseBy,
      frappeTicket.resolutionBy,
    ]
  );

  // Same "log a real activity" convention as every other integration
  // (whatsapp-service.ts, smartflo-service.ts) - without this, raising a
  // ticket would be invisible on the lead's own Activity timeline. Caught,
  // not rethrown: the ticket already exists in Frappe and locally by this
  // point, so a failure here must not turn into a 500 that reads as "ticket
  // creation failed" - a confused retry would create a genuine duplicate
  // ticket in Frappe, which has no idempotency key to catch that.
  try {
    await createActivityForLead(
      leadId,
      {
        type: "support_ticket",
        subject: `Support ticket raised: ${subject}`,
        status: "completed",
        externalRefId: frappeTicket.frappeTicketName,
      },
      requestingUserId
    );
  } catch (err) {
    console.error(`Failed to log activity for new support ticket ${frappeTicket.frappeTicketName}:`, err);
  }

  return toPublicTicket(result.rows[0]);
}

export async function listTicketsForLead(leadId: string, requestingUserId: string) {
  await getLeadById(leadId, requestingUserId);

  const result = await pool.query<SupportTicketRow>(
    "SELECT * FROM support_tickets WHERE lead_id = $1 ORDER BY created_at DESC",
    [leadId]
  );
  return result.rows.map(toPublicTicket);
}

// Loads the ticket and, via getLeadById, enforces that its lead is visible
// to the requesting user - every exported function below that takes a
// ticketId calls this first, so none of them can be reached for a ticket
// whose lead the caller can't see.
async function getVisibleTicketOrThrow(ticketId: string, requestingUserId: string): Promise<SupportTicketRow> {
  const result = await pool.query<SupportTicketRow>(
    `SELECT t.*, l.full_name AS lead_full_name, u.name AS created_by_name, au.name AS assigned_to_name,
       EXISTS (SELECT 1 FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.direction = 'outbound') AS has_responded
     FROM support_tickets t
     JOIN leads l ON l.id = t.lead_id
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN users au ON au.id = t.assigned_to
     WHERE t.id = $1`,
    [ticketId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Support ticket not found");
  }
  const ticket = result.rows[0];
  await getLeadById(ticket.lead_id, requestingUserId);
  return ticket;
}

export async function getTicketById(ticketId: string, requestingUserId: string) {
  const ticket = await getVisibleTicketOrThrow(ticketId, requestingUserId);
  return toPublicTicket(ticket);
}

// The resolve/close action - lets an agent change a ticket's status from
// inside FieldForce itself, rather than needing Frappe's own UI (closing
// the gap that otherwise would have left this one action requiring direct
// Frappe access, contrary to the whole point of this integration).
export async function updateTicketStatus(ticketId: string, status: string, requestingUserId: string) {
  const ticket = await getVisibleTicketOrThrow(ticketId, requestingUserId);

  if (!ticket.frappe_ticket_name) {
    throw new ApiError(409, "This ticket has no linked Frappe ticket yet");
  }

  await frappeService.updateTicketStatusInFrappe(ticket.frappe_ticket_name, status);

  const result = await pool.query<SupportTicketRow>(
    "UPDATE support_tickets SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [status, ticketId]
  );

  // Caught, not rethrown - the status change already succeeded in Frappe
  // and locally by this point, same reasoning as createTicketForLead above.
  try {
    await createActivityForLead(
      ticket.lead_id,
      {
        type: "support_ticket",
        subject: `Support ticket marked ${status}: ${ticket.subject}`,
        status: "completed",
        externalRefId: ticket.frappe_ticket_name,
      },
      requestingUserId
    );
  } catch (err) {
    console.error(`Failed to log activity for ticket status change ${ticket.frappe_ticket_name}:`, err);
  }

  return toPublicTicket(result.rows[0]);
}

// Who's actually working this ticket - a FieldForce-only field (see
// model.ts's own comment on the column), so unlike updateTicketStatus/
// replyToTicket above there's no Frappe API call here, nothing that can
// fail on Frappe's side. assigneeId can be any real user (not restricted
// to this ticket's lead's visibility scope - a deliberate choice, since
// assignment is about who does the work, not who's allowed to see it,
// which is already enforced separately via getVisibleTicketOrThrow).
export async function assignTicket(ticketId: string, assigneeId: string | null, requestingUserId: string) {
  const ticket = await getVisibleTicketOrThrow(ticketId, requestingUserId);

  let assigneeName: string | null = null;
  if (assigneeId) {
    const assignee = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [assigneeId]);
    if (assignee.rows.length === 0) {
      throw new ApiError(404, "That user doesn't exist");
    }
    assigneeName = assignee.rows[0].name;
  }

  await pool.query("UPDATE support_tickets SET assigned_to = $1, updated_at = now() WHERE id = $2", [assigneeId, ticketId]);

  // Same "nothing to do" try/catch as every other write here - the
  // assignment itself already committed above, so a failure logging it
  // must not read back as the assignment having failed.
  try {
    await createActivityForLead(
      ticket.lead_id,
      {
        type: "support_ticket",
        subject: assigneeName ? `Support ticket assigned to ${assigneeName}: ${ticket.subject}` : `Support ticket unassigned: ${ticket.subject}`,
        status: "completed",
        externalRefId: ticket.frappe_ticket_name ?? undefined,
      },
      requestingUserId
    );
  } catch (err) {
    console.error(`Failed to log activity for ticket assignment on ${ticketId}:`, err);
  }

  return getTicketById(ticketId, requestingUserId);
}

export async function replyToTicket(ticketId: string, message: string, requestingUserId: string) {
  const ticket = await getVisibleTicketOrThrow(ticketId, requestingUserId);

  if (!ticket.frappe_ticket_name) {
    throw new ApiError(409, "This ticket has no linked Frappe ticket yet");
  }

  await frappeService.replyToTicketInFrappe(ticket.frappe_ticket_name, message);

  const result = await pool.query<SupportTicketMessageRow>(
    `INSERT INTO support_ticket_messages (ticket_id, direction, body, sent_by)
     VALUES ($1, 'outbound', $2, $3)
     RETURNING *`,
    [ticketId, message, requestingUserId]
  );

  // Caught, not rethrown - the reply already sent via Frappe and saved
  // locally by this point, same reasoning as createTicketForLead above.
  try {
    await createActivityForLead(
      ticket.lead_id,
      {
        type: "support_ticket",
        subject: `Replied to support ticket: ${ticket.subject}`,
        status: "completed",
        externalRefId: ticket.frappe_ticket_name,
      },
      requestingUserId
    );
  } catch (err) {
    console.error(`Failed to log activity for ticket reply ${ticket.frappe_ticket_name}:`, err);
  }

  return toPublicMessage(result.rows[0]);
}

// Everything below is for Phase 2's webhook - called from Frappe itself,
// not an authenticated FieldForce user, so (matching whatsapp-service.ts's
// own handleWebhookEvent) there's no requestingUserId to check lead
// visibility against and no Activity log entry raised, the same scope
// whatsapp's inbound-message path already settled on for this exact kind of
// system-to-system write.

// Silently no-ops when the ticket isn't one we track locally (e.g. it was
// never created through FieldForce), or when its lead has since been
// soft-deleted (support_tickets.lead_id's ON DELETE CASCADE only ever
// fires on a real DELETE, which leads never get - every lead delete is the
// is_deleted soft-delete, so without this check a ticket for an already
// "deleted" lead would keep accepting webhook writes forever, invisibly,
// since every UI/API surface filters is_deleted = false) - same
// "nothing to do" shape as whatsapp-service.ts's `if (!leadId) continue`,
// not an error condition.
// priority is optional since the webhook payload only includes it once the
// Frappe-side Webhook Data template is updated to send it - older deliveries
// (or a site that hasn't added it yet) still carry status alone.
//
// status/priority are validated against the same real, confirmed value
// lists the authenticated PATCH path enforces (TICKET_STATUSES/
// TICKET_PRIORITIES) - not to reject Frappe's payload (there's no one to
// return an error to), but so a renamed/re-cased doctype value on the
// Frappe side can't silently corrupt this ticket's status/priority into
// something the dashboard's exact-match counts and the status/priority Tag
// color lookups then can't recognize. An unrecognized value is logged and
// that one field is left unchanged rather than written as-is.
export async function syncTicketStatusFromWebhook(
  frappeTicketName: string,
  status: string,
  priority?: string
): Promise<void> {
  const ticket = await pool.query<{ id: string }>(
    `SELECT t.id FROM support_tickets t JOIN leads l ON l.id = t.lead_id
     WHERE t.frappe_ticket_name = $1 AND l.is_deleted = false`,
    [frappeTicketName]
  );
  if (ticket.rows.length === 0) return;

  const validStatus = (TICKET_STATUSES as readonly string[]).includes(status) ? status : null;
  if (!validStatus) {
    console.error(`syncTicketStatusFromWebhook: unrecognized status "${status}" for ticket ${frappeTicketName}, leaving status unchanged`);
  }
  const validPriority = priority && (TICKET_PRIORITIES as readonly string[]).includes(priority) ? priority : null;
  if (priority && !validPriority) {
    console.error(`syncTicketStatusFromWebhook: unrecognized priority "${priority}" for ticket ${frappeTicketName}, leaving priority unchanged`);
  }

  if (validStatus && validPriority) {
    await pool.query("UPDATE support_tickets SET status = $1, priority = $2, updated_at = now() WHERE id = $3", [
      validStatus,
      validPriority,
      ticket.rows[0].id,
    ]);
  } else if (validStatus) {
    await pool.query("UPDATE support_tickets SET status = $1, updated_at = now() WHERE id = $2", [validStatus, ticket.rows[0].id]);
  } else if (validPriority) {
    await pool.query("UPDATE support_tickets SET priority = $1, updated_at = now() WHERE id = $2", [validPriority, ticket.rows[0].id]);
  }
}

// frappeCommunicationName is Frappe's own Communication doc name - the
// ON CONFLICT DO NOTHING is what makes a retried webhook delivery (Frappe
// does retry) a safe no-op instead of a duplicate message on the ticket.
export async function recordInboundReplyFromWebhook(
  frappeTicketName: string,
  body: string,
  frappeCommunicationName: string
): Promise<void> {
  // Same soft-delete check as syncTicketStatusFromWebhook above - without
  // it, a lead soft-deleted while its Frappe ticket is still open would
  // keep silently accumulating inbound messages nobody can ever read back.
  const ticket = await pool.query<{ id: string }>(
    `SELECT t.id FROM support_tickets t JOIN leads l ON l.id = t.lead_id
     WHERE t.frappe_ticket_name = $1 AND l.is_deleted = false`,
    [frappeTicketName]
  );
  if (ticket.rows.length === 0) return;

  // A real customer reply arrives as the email's full HTML (Frappe's
  // Communication.content, confirmed against a genuine inbox reply, not
  // just a manually-typed test message) - rendered as plain text in the
  // reply thread (see SupportTicketDetailDrawer.tsx's Bubble component),
  // raw HTML would otherwise show up as literal <table>/<div> markup
  // instead of readable text. Converted once here, at write time, so the
  // stored value is already clean - same plain-text shape an outbound
  // reply typed directly in FieldForce already has.
  const plainTextBody = convert(body, { wordwrap: false });

  // The ON CONFLICT target has to repeat the partial index's own WHERE
  // clause verbatim (model.ts's idx_support_ticket_messages_frappe_
  // communication_name) - Postgres only infers a partial unique index as
  // the arbiter when the predicate matches exactly, not from the column
  // list alone.
  await pool.query(
    `INSERT INTO support_ticket_messages (ticket_id, direction, body, frappe_communication_name)
     VALUES ($1, 'inbound', $2, $3)
     ON CONFLICT (frappe_communication_name) WHERE frappe_communication_name IS NOT NULL DO NOTHING`,
    [ticket.rows[0].id, plainTextBody, frappeCommunicationName]
  );
}

export async function listMessagesForTicket(ticketId: string, requestingUserId: string) {
  await getVisibleTicketOrThrow(ticketId, requestingUserId);

  const result = await pool.query<SupportTicketMessageRow>(
    "SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
    [ticketId]
  );
  return result.rows.map(toPublicMessage);
}
