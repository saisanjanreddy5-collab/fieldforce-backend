import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { getLeadById } from "./lead-service";
import { createActivityForLead } from "./activity-service";
import * as frappeService from "./frappe-service";

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

interface SupportTicketRow {
  id: string;
  lead_id: string;
  subject: string;
  description: string | null;
  status: string;
  frappe_ticket_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Only present on queries that join leads/users for display purposes
  // (same split quote-service.ts uses) - undefined, not null, when a query
  // doesn't select them, so toPublicTicket can tell "not joined" apart from
  // "joined but genuinely has no name".
  lead_full_name?: string;
  created_by_name?: string | null;
}

function toPublicTicket(row: SupportTicketRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadFullName: row.lead_full_name ?? null,
    subject: row.subject,
    description: row.description,
    status: row.status,
    frappeTicketName: row.frappe_ticket_name,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
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
    // and the same admin-sees-unassigned-leads carve-out) - without the last
    // clause, a ticket on an unowned lead an admin can otherwise see via
    // GET /leads/:id/support-tickets would silently disappear from this
    // top-level listing for that same admin.
    `(l.owner_id IN (SELECT id FROM subtree)
      OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
      OR (l.owner_id IS NULL AND EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin')))`,
  ];
  const params: unknown[] = [requestingUserId];

  if (filters.leadId) {
    params.push(filters.leadId);
    conditions.push(`t.lead_id = $${params.length}`);
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
  // just to show who a ticket belongs to.
  const result = await pool.query<SupportTicketRow>(
    `${TICKET_VISIBILITY_SUBTREE_CTE}
     SELECT t.*, l.full_name AS lead_full_name, u.name AS created_by_name
     FROM support_tickets t
     INNER JOIN leads l ON l.id = t.lead_id
     LEFT JOIN users u ON u.id = t.created_by
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
  requestingUserId: string
) {
  // Throws 403/404 on its own if this lead isn't visible/doesn't exist -
  // also gives us the lead's email to hand Frappe as raised_by.
  const lead = await getLeadById(leadId, requestingUserId);

  // `||`, not `??` - a lead with email set to "" (not null) must still be
  // treated as "no email", same as it would be for any other falsy-but-not-
  // nullish value here.
  const frappeTicket = await frappeService.createTicketInFrappe(subject, description, lead.email || undefined);

  const result = await pool.query<SupportTicketRow>(
    `INSERT INTO support_tickets (lead_id, subject, description, status, frappe_ticket_name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [leadId, subject, description ?? null, frappeTicket.status, frappeTicket.frappeTicketName, requestingUserId]
  );

  // Same "log a real activity" convention as every other integration
  // (whatsapp-service.ts, smartflo-service.ts) - without this, raising a
  // ticket would be invisible on the lead's own Activity timeline.
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
    `SELECT t.*, l.full_name AS lead_full_name, u.name AS created_by_name
     FROM support_tickets t
     JOIN leads l ON l.id = t.lead_id
     LEFT JOIN users u ON u.id = t.created_by
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

  return toPublicMessage(result.rows[0]);
}

// Everything below is for Phase 2's webhook - called from Frappe itself,
// not an authenticated FieldForce user, so (matching whatsapp-service.ts's
// own handleWebhookEvent) there's no requestingUserId to check lead
// visibility against and no Activity log entry raised, the same scope
// whatsapp's inbound-message path already settled on for this exact kind of
// system-to-system write.

// Silently no-ops when the ticket isn't one we track locally (e.g. it was
// never created through FieldForce) - same "nothing to do" shape as
// whatsapp-service.ts's `if (!leadId) continue`, not an error condition.
export async function syncTicketStatusFromWebhook(frappeTicketName: string, status: string): Promise<void> {
  await pool.query("UPDATE support_tickets SET status = $1, updated_at = now() WHERE frappe_ticket_name = $2", [
    status,
    frappeTicketName,
  ]);
}

// frappeCommunicationName is Frappe's own Communication doc name - the
// ON CONFLICT DO NOTHING is what makes a retried webhook delivery (Frappe
// does retry) a safe no-op instead of a duplicate message on the ticket.
export async function recordInboundReplyFromWebhook(
  frappeTicketName: string,
  body: string,
  frappeCommunicationName: string
): Promise<void> {
  const ticket = await pool.query<{ id: string }>("SELECT id FROM support_tickets WHERE frappe_ticket_name = $1", [
    frappeTicketName,
  ]);
  if (ticket.rows.length === 0) return;

  // The ON CONFLICT target has to repeat the partial index's own WHERE
  // clause verbatim (model.ts's idx_support_ticket_messages_frappe_
  // communication_name) - Postgres only infers a partial unique index as
  // the arbiter when the predicate matches exactly, not from the column
  // list alone.
  await pool.query(
    `INSERT INTO support_ticket_messages (ticket_id, direction, body, frappe_communication_name)
     VALUES ($1, 'inbound', $2, $3)
     ON CONFLICT (frappe_communication_name) WHERE frappe_communication_name IS NOT NULL DO NOTHING`,
    [ticket.rows[0].id, body, frappeCommunicationName]
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
