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
}

function toPublicTicket(row: SupportTicketRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    frappeTicketName: row.frappe_ticket_name,
    createdBy: row.created_by,
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
    "(l.owner_id IN (SELECT id FROM subtree) OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1))",
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
  const result = await pool.query<SupportTicketRow>(
    `${TICKET_VISIBILITY_SUBTREE_CTE}
     SELECT t.* FROM support_tickets t
     INNER JOIN leads l ON l.id = t.lead_id
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

  const frappeTicket = await frappeService.createTicketInFrappe(subject, description, lead.email ?? undefined);

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
  const result = await pool.query<SupportTicketRow>("SELECT * FROM support_tickets WHERE id = $1", [ticketId]);
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

export async function listMessagesForTicket(ticketId: string, requestingUserId: string) {
  await getVisibleTicketOrThrow(ticketId, requestingUserId);

  const result = await pool.query<SupportTicketMessageRow>(
    "SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
    [ticketId]
  );
  return result.rows.map(toPublicMessage);
}
