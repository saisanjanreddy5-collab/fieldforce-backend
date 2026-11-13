import { pool } from "../config/db";

// Support Tickets no longer has its own create/update/reply/webhook system
// in this app - Frappe Helpdesk owns that entirely now, reached via SSO (see
// nav-config.tsx's "Support tickets" entry). The old support_tickets/
// support_ticket_messages tables and their historical rows are kept
// on purpose (not dropped), so this one read-only function survives solely
// to let a Customer's own timeline keep showing tickets that were genuinely
// raised before the cutover - nothing writes to these tables anymore.
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
  lead_full_name?: string;
  created_by_name?: string | null;
  assigned_to_name?: string | null;
  has_responded?: boolean;
}

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

export interface ListLegacyTicketsFilters {
  leadId?: string;
  page: number;
  limit: number;
}

// Mirrors listLeadsForUser's own scoping (lead owner in my subtree, or
// shared with me) by joining into leads, same as the rest of this app's
// lead-scoped data - unchanged from the original listSupportTickets.
export async function listLegacyTicketsForLead(requestingUserId: string, filters: ListLegacyTicketsFilters) {
  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const conditions = [
    "l.is_deleted = false",
    `(l.owner_id IN (SELECT id FROM subtree)
      OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
      OR EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin'))`,
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

  return { tickets: result.rows.map(toPublicTicket), total: Number(countResult.rows[0].count) };
}
