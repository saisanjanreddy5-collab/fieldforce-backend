import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { recordAuditEvent, listAuditLogForEntity } from "./audit-log-service";
import { listActivitiesForLead } from "./activity-service";
import { listSupportTickets } from "./support-ticket-service";
import { listOrderRowsForCustomer, countOpenOrders } from "./sales-order-service";
import { listInvoiceRowsForCustomer, countOverdueInvoices } from "./invoice-service";
import { listPaymentRowsForCustomer, sumClearedPayments } from "./payment-service";

// Same hierarchy-visibility rule as leads/activities/expenses/leave: a
// customer is visible to its owner and to everyone above the owner in the
// reporting chain, found by walking DOWN from the requesting user (see
// lead-service.ts's own SUBTREE_CTE for the full rationale - this is the
// identical pattern, just over customers.owner_id instead of
// leads.owner_id).
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// Mirrors lead-service.ts's UNASSIGNED_ADMIN_CLAUSE exactly: admin is a
// global role, not a node in the reporting chain, so it gets an
// unconditional bypass here rather than being limited to its own subtree
// (which would otherwise leave one admin unable to see another admin's
// branch's customers, including unowned ones left behind by a no-owner
// lead at conversion time).
const UNASSIGNED_ADMIN_CLAUSE = `
  OR EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin')
`;

interface CustomerRow {
  id: string;
  customer_number: number;
  lead_id: string;
  full_name: string;
  contact_name: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  company_name: string | null;
  category: string | null;
  owner_id: string | null;
  city: string | null;
  zone_id: string | null;
  state_id: string | null;
  district_id: string | null;
  area_id: string | null;
  pincode: string | null;
  address_line1: string | null;
  address_line2: string | null;
  territory: string | null;
  credit_limit: string;
  outstanding_balance: string;
  credit_category: string | null;
  status: string;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  owner_name?: string | null;
  district_name?: string | null;
  open_ticket_count?: string;
  lifetime_value?: string;
  open_orders_count?: string;
  overdue_invoices_count?: string;
}

export function customerLabel(customerNumber: number): string {
  return `C-${String(customerNumber).padStart(5, "0")}`;
}

function toPublicCustomer(row: CustomerRow) {
  return {
    id: row.id,
    customerNumber: row.customer_number,
    customerLabel: customerLabel(row.customer_number),
    leadId: row.lead_id,
    fullName: row.full_name,
    contactName: row.contact_name,
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    companyName: row.company_name,
    category: row.category,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? null,
    // Honest fallback, not a guess: the lead's own store_city (FOFO
    // onboarding only) when present, else the district every lead/customer
    // genuinely has - never left silently blank when a real-enough answer
    // already exists in data we already have.
    city: row.city ?? row.district_name ?? null,
    zoneId: row.zone_id,
    stateId: row.state_id,
    districtId: row.district_id,
    areaId: row.area_id,
    pincode: row.pincode,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    territory: row.territory,
    creditLimit: Number(row.credit_limit),
    outstandingBalance: Number(row.outstanding_balance),
    creditCategory: row.credit_category,
    status: row.status,
    openTicketCount: row.open_ticket_count !== undefined ? Number(row.open_ticket_count) : undefined,
    // Real transaction metrics - only populated on the single-record fetch
    // (getCustomerById), not the list, same reasoning openTicketCount could
    // have followed but didn't need to: the list view never displays these,
    // only the detail panel's Overview tab does.
    lifetimeValue: row.lifetime_value !== undefined ? Number(row.lifetime_value) : undefined,
    openOrdersCount: row.open_orders_count !== undefined ? Number(row.open_orders_count) : undefined,
    overdueInvoicesCount: row.overdue_invoices_count !== undefined ? Number(row.overdue_invoices_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Called from lead-service.ts's updateLead the moment a lead's status
// transitions to 'converted'. Takes the lead's already-fetched row instead
// of re-querying it, and never throws - a failure here (e.g. a race where
// the lead was converted twice concurrently) should not fail the lead
// update itself, which is why ON CONFLICT DO NOTHING plus a try/catch guard
// the caller instead of propagating.
export async function createCustomerFromLead(lead: {
  id: string;
  full_name: string;
  contact_name: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  company_name: string | null;
  category: string | null;
  owner_id: string | null;
  store_city: string | null;
  zone_id: string | null;
  state_id: string | null;
  district_id: string | null;
  area_id: string | null;
  pincode: string | null;
  address_line1: string | null;
  address_line2: string | null;
  territory: string | null;
  credit_limit_requested: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO customers (
       lead_id, full_name, contact_name, phone, alt_phone, email, company_name, category,
       owner_id, city, zone_id, state_id, district_id, area_id, pincode, address_line1, address_line2,
       territory, credit_limit
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (lead_id) DO NOTHING`,
    [
      lead.id,
      lead.full_name,
      lead.contact_name,
      lead.phone,
      lead.alt_phone,
      lead.email,
      lead.company_name,
      lead.category,
      lead.owner_id,
      lead.store_city,
      lead.zone_id,
      lead.state_id,
      lead.district_id,
      lead.area_id,
      lead.pincode,
      lead.address_line1,
      lead.address_line2,
      lead.territory,
      lead.credit_limit_requested ?? 0,
    ]
  );
}

// Called from lead-service.ts's updateLead (a single lead's owner changing)
// and scheduled-transfer-service.ts's bulk reassignment (an exiting rep's
// whole book moving to someone else) - both only ever wrote leads.owner_id,
// never propagating to the already-converted customer this same lead may
// have produced. That left every inherited customer account permanently
// attached to the departed/previous rep: the real bug the offboarding
// transfer feature exists to prevent. A no-op (zero rows affected) when
// this lead never converted, same as createCustomerFromLead's own
// ON CONFLICT DO NOTHING - never something the caller needs to branch on.
export async function syncCustomerOwnerFromLead(leadId: string, newOwnerId: string | null): Promise<void> {
  await pool.query(
    "UPDATE customers SET owner_id = $1, updated_at = now() WHERE lead_id = $2 AND is_deleted = false",
    [newOwnerId, leadId]
  );
}

// Exported for customer-contact-service.ts/customer-address-service.ts/
// sales-order-service.ts/invoice-service.ts/payment-service.ts - every one
// of those is a sub-resource of a customer, so they all gate on this same
// parent-visibility check rather than re-deriving their own.
export async function isCustomerInScope(customerId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM customers c
     WHERE c.id = $2 AND c.is_deleted = false
       AND (
         c.owner_id IN (SELECT id FROM subtree)
         ${UNASSIGNED_ADMIN_CLAUSE}
       )`,
    [userId, customerId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface ListCustomersFilters {
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

export async function listCustomers(requestingUserId: string, filters: ListCustomersFilters) {
  const conditions: string[] = ["c.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(`(
    c.owner_id IN (SELECT id FROM subtree)
    ${UNASSIGNED_ADMIN_CLAUSE}
  )`);

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const idx = params.length;
    conditions.push(`(c.full_name ILIKE $${idx} OR c.company_name ILIKE $${idx} OR c.phone ILIKE $${idx})`);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE} SELECT COUNT(*) FROM customers c WHERE ${whereClause}`,
    params
  );

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;
  const listParams = [...params, limit, offset];

  const result = await pool.query<CustomerRow>(
    `${SUBTREE_CTE}
     SELECT c.*, u.name AS owner_name, d.name AS district_name,
       (SELECT COUNT(*) FROM support_tickets st WHERE st.lead_id = c.lead_id AND st.status NOT IN ('Resolved','Closed')) AS open_ticket_count
     FROM customers c
     LEFT JOIN users u ON u.id = c.owner_id
     LEFT JOIN districts d ON d.id = c.district_id
     WHERE ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { customers: result.rows.map(toPublicCustomer), total: Number(countResult.rows[0].count) };
}

export async function getCustomerById(customerId: string, requestingUserId: string) {
  const inScope = await isCustomerInScope(customerId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this customer");
  }

  const result = await pool.query<CustomerRow>(
    `SELECT c.*, u.name AS owner_name, d.name AS district_name,
       (SELECT COUNT(*) FROM support_tickets st WHERE st.lead_id = c.lead_id AND st.status NOT IN ('Resolved','Closed')) AS open_ticket_count
     FROM customers c
     LEFT JOIN users u ON u.id = c.owner_id
     LEFT JOIN districts d ON d.id = c.district_id
     WHERE c.id = $1 AND c.is_deleted = false`,
    [customerId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Customer not found");
  }
  const row = result.rows[0];

  // Real transaction metrics for the Overview tab - computed from the same
  // sales_orders/invoices/payments tables the Transactions tab itself reads,
  // never a separate cached/estimated figure.
  const [lifetimeValue, openOrdersCount, overdueInvoicesCount] = await Promise.all([
    sumClearedPayments(customerId),
    countOpenOrders(customerId),
    countOverdueInvoices(customerId),
  ]);
  row.lifetime_value = String(lifetimeValue);
  row.open_orders_count = String(openOrdersCount);
  row.overdue_invoices_count = String(overdueInvoicesCount);

  return toPublicCustomer(row);
}

export interface UpdateCustomerInput {
  ownerId?: string | null;
  status?: string;
  creditLimit?: number;
  outstandingBalance?: number;
  creditCategory?: string | null;
}

export async function updateCustomer(
  customerId: string,
  updates: UpdateCustomerInput,
  requestingUserId: string
): Promise<ReturnType<typeof toPublicCustomer>> {
  const inScope = await isCustomerInScope(customerId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this customer");
  }

  // Credit/balance/owner changes go to the real Audit trail - the same
  // standard Leads already holds owner_reassigned to, and every other
  // financially-relevant action in this app (expense approvals,
  // credit_limit_requested on FOFO onboarding).
  const tracksChange =
    updates.creditLimit !== undefined ||
    updates.outstandingBalance !== undefined ||
    updates.ownerId !== undefined ||
    updates.creditCategory !== undefined;
  let before: {
    full_name: string;
    credit_limit: string;
    outstanding_balance: string;
    owner_id: string | null;
    credit_category: string | null;
  } | null = null;
  if (tracksChange) {
    const beforeResult = await pool.query<{
      full_name: string;
      credit_limit: string;
      outstanding_balance: string;
      owner_id: string | null;
      credit_category: string | null;
    }>("SELECT full_name, credit_limit, outstanding_balance, owner_id, credit_category FROM customers WHERE id = $1", [customerId]);
    before = beforeResult.rows[0] ?? null;
  }

  const fieldMap: Record<string, unknown> = {
    owner_id: updates.ownerId,
    status: updates.status,
    credit_limit: updates.creditLimit,
    outstanding_balance: updates.outstandingBalance,
    credit_category: updates.creditCategory,
  };

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) {
    return getCustomerById(customerId, requestingUserId);
  }

  params.push(requestingUserId);
  setClauses.push(`updated_by = $${params.length}`);
  setClauses.push(`updated_at = now()`);
  params.push(customerId);

  const result = await pool.query<CustomerRow>(
    `UPDATE customers SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  if (before) {
    const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);
    const actorName = actorResult.rows[0]?.name ?? null;

    if (updates.creditLimit !== undefined && updates.creditLimit !== Number(before.credit_limit)) {
      await recordAuditEvent({
        entityType: "customer",
        entityId: customerId,
        entityLabel: before.full_name,
        action: "credit_limit_changed",
        summary: `Credit limit changed - ${before.full_name}`,
        oldValue: before.credit_limit,
        newValue: String(updates.creditLimit),
        actorId: requestingUserId,
        actorName,
      });
    }
    if (updates.outstandingBalance !== undefined && updates.outstandingBalance !== Number(before.outstanding_balance)) {
      await recordAuditEvent({
        entityType: "customer",
        entityId: customerId,
        entityLabel: before.full_name,
        action: "outstanding_balance_changed",
        summary: `Outstanding balance changed - ${before.full_name}`,
        oldValue: before.outstanding_balance,
        newValue: String(updates.outstandingBalance),
        actorId: requestingUserId,
        actorName,
      });
    }
    if (updates.ownerId !== undefined && updates.ownerId !== before.owner_id) {
      const ownerIds = [before.owner_id, updates.ownerId].filter((id): id is string => id !== null);
      const namesResult = ownerIds.length
        ? await pool.query<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ANY($1)", [ownerIds])
        : { rows: [] as { id: string; name: string }[] };
      const nameById = new Map(namesResult.rows.map((r) => [r.id, r.name]));
      await recordAuditEvent({
        entityType: "customer",
        entityId: customerId,
        entityLabel: before.full_name,
        action: "owner_reassigned",
        summary: `Salesperson reassigned - ${before.full_name}`,
        oldValue: before.owner_id ? nameById.get(before.owner_id) ?? "Unassigned" : "Unassigned",
        newValue: updates.ownerId ? nameById.get(updates.ownerId) ?? "Unassigned" : "Unassigned",
        actorId: requestingUserId,
        actorName,
      });
    }
    if (updates.creditCategory !== undefined && updates.creditCategory !== before.credit_category) {
      await recordAuditEvent({
        entityType: "customer",
        entityId: customerId,
        entityLabel: before.full_name,
        action: "credit_category_changed",
        summary: `Credit category changed - ${before.full_name}`,
        oldValue: before.credit_category ?? "Unrated",
        newValue: updates.creditCategory ?? "Unrated",
        actorId: requestingUserId,
        actorName,
      });
    }
  }

  return toPublicCustomer(result.rows[0]);
}

// Powers the detail panel's Transactions tab - sales orders, invoices, and
// payments merged into one real chronological feed, each row tagged with
// its real kind so the frontend can render the right icon/label. Nothing
// here is synthesized: every entry is a genuine row from its own table.
export async function getCustomerTransactions(customerId: string, requestingUserId: string) {
  const inScope = await isCustomerInScope(customerId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this customer");
  }

  const [orders, invoices, payments] = await Promise.all([
    listOrderRowsForCustomer(customerId),
    listInvoiceRowsForCustomer(customerId),
    listPaymentRowsForCustomer(customerId),
  ]);

  const merged = [
    ...orders.map((o) => ({ kind: "sales_order" as const, id: o.id, label: o.orderLabel, date: o.orderDate, status: o.status, amount: o.amount })),
    ...invoices.map((i) => ({
      kind: "invoice" as const,
      id: i.id,
      label: i.invoiceLabel,
      date: i.invoiceDate,
      status: i.isOverdue ? "overdue" : i.status,
      amount: i.amount,
    })),
    ...payments.map((p) => ({ kind: "payment" as const, id: p.id, label: p.receiptLabel, date: p.paymentDate, status: p.status, amount: p.amount })),
  ];

  // getTime(), not localeCompare - DATE columns come back from pg as plain
  // strings but TIMESTAMPTZ columns (activities/audit_log's created_at)
  // come back as real Date objects, and new Date(x) accepts either form.
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return merged;
}

// Powers the detail panel's Activity tab - real Activities (calls/emails/
// site visits), real Support Tickets raised for this account, and this
// customer's own real Audit trail (credit/balance/owner/category changes),
// merged into one chronological timeline. Activities is best-effort: if the
// originating lead's own visibility has drifted from the customer's (see
// the owner-reassignment note in customer-module-progress memory), this
// falls back to an empty list rather than failing the whole timeline.
export async function getCustomerTimeline(customerId: string, requestingUserId: string) {
  const inScope = await isCustomerInScope(customerId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this customer");
  }

  const customerResult = await pool.query<{ lead_id: string }>("SELECT lead_id FROM customers WHERE id = $1", [customerId]);
  if (customerResult.rows.length === 0) {
    throw new ApiError(404, "Customer not found");
  }
  const leadId = customerResult.rows[0].lead_id;

  const [activities, ticketsResult, auditEvents] = await Promise.all([
    listActivitiesForLead(leadId, requestingUserId).catch(() => []),
    listSupportTickets(requestingUserId, { leadId, page: 1, limit: 200 }).catch(() => ({ supportTickets: [], total: 0 })),
    listAuditLogForEntity("customer", customerId),
  ]);

  const merged = [
    ...activities.map((a) => ({
      kind: "activity" as const,
      id: a.id,
      summary: a.subject ?? a.type,
      detail: a.type,
      date: a.createdAt,
      actorName: null as string | null,
    })),
    ...ticketsResult.supportTickets.map((t) => ({
      kind: "ticket" as const,
      id: t.id,
      summary: `Ticket - ${t.subject}`,
      detail: t.status,
      date: t.createdAt,
      actorName: t.createdByName,
    })),
    ...auditEvents.map((e) => ({
      kind: "audit" as const,
      id: e.id,
      summary: e.summary,
      detail: e.oldValue && e.newValue ? `${e.oldValue} -> ${e.newValue}` : null,
      date: e.createdAt,
      actorName: e.actorName,
    })),
  ];

  // getTime(), not localeCompare - DATE columns come back from pg as plain
  // strings but TIMESTAMPTZ columns (activities/audit_log's created_at)
  // come back as real Date objects, and new Date(x) accepts either form.
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return merged;
}
