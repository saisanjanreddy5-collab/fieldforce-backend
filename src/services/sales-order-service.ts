import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isCustomerInScope } from "./customer-service";
import { recordAuditEvent } from "./audit-log-service";

interface SalesOrderRow {
  id: string;
  order_number: number;
  customer_id: string;
  order_date: string;
  status: string;
  amount: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Year comes from the order's own order_date, not "now" - otherwise every
// existing label would silently flip to the new year the moment the
// calendar turns, since order_number itself never resets annually. Sliced
// from the string directly (order_date is a DATE column, returned as
// "YYYY-MM-DD" by node-postgres) rather than parsed through `new Date()`,
// which would re-introduce the exact UTC-midnight/local-timezone drift
// that caused invoice-service.ts's isOverdue to disagree with its own
// SQL-side count.
export function orderLabel(orderNumber: number, orderDate: string): string {
  return `SO-${orderDate.slice(0, 4)}-${String(orderNumber).padStart(4, "0")}`;
}

function toPublicOrder(row: SalesOrderRow) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    orderLabel: orderLabel(row.order_number, row.order_date),
    customerId: row.customer_id,
    orderDate: row.order_date,
    status: row.status,
    amount: Number(row.amount),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertInScope(customerId: string, requestingUserId: string): Promise<void> {
  const inScope = await isCustomerInScope(customerId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this customer");
  }
}

export async function listOrdersForCustomer(customerId: string, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<SalesOrderRow>(
    "SELECT * FROM sales_orders WHERE customer_id = $1 ORDER BY order_date DESC, created_at DESC",
    [customerId]
  );
  return result.rows.map(toPublicOrder);
}

export interface SalesOrderInput {
  orderDate?: string;
  status?: string;
  amount: number;
  notes?: string;
}

export async function createOrder(customerId: string, input: SalesOrderInput, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<SalesOrderRow>(
    `INSERT INTO sales_orders (customer_id, order_date, status, amount, notes, created_by)
     VALUES ($1, COALESCE($2, CURRENT_DATE), COALESCE($3,'confirmed'), $4, $5, $6)
     RETURNING *`,
    [customerId, input.orderDate ?? null, input.status ?? null, input.amount, input.notes ?? null, requestingUserId]
  );
  return toPublicOrder(result.rows[0]);
}

async function getOrderOrThrow(orderId: string): Promise<SalesOrderRow> {
  const result = await pool.query<SalesOrderRow>("SELECT * FROM sales_orders WHERE id = $1", [orderId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Sales order not found");
  }
  return result.rows[0];
}

export async function updateOrder(orderId: string, input: Partial<SalesOrderInput>, requestingUserId: string) {
  const existing = await getOrderOrThrow(orderId);
  await assertInScope(existing.customer_id, requestingUserId);

  const fieldMap: Record<string, unknown> = {
    order_date: input.orderDate,
    status: input.status,
    amount: input.amount,
    notes: input.notes,
  };
  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }
  if (setClauses.length === 0) return toPublicOrder(existing);

  setClauses.push("updated_at = now()");
  params.push(orderId);
  const result = await pool.query<SalesOrderRow>(
    `UPDATE sales_orders SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicOrder(result.rows[0]);
}

export async function deleteOrder(orderId: string, requestingUserId: string): Promise<void> {
  const existing = await getOrderOrThrow(orderId);
  await assertInScope(existing.customer_id, requestingUserId);
  await pool.query("DELETE FROM sales_orders WHERE id = $1", [orderId]);

  // There's no is_deleted column here (a hard DELETE is the real, correct
  // behavior for this table - see model.ts), so this audit entry is the
  // only trace that a real sales order ever existed once it's gone.
  // Matches the seriousness updateCustomer's own credit/balance changes
  // already get - deleting a real financial record is at least as
  // consequential.
  const actorName = (await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId])).rows[0]?.name ?? null;
  await recordAuditEvent({
    entityType: "sales_order",
    entityId: orderId,
    entityLabel: orderLabel(existing.order_number, existing.order_date),
    action: "deleted",
    summary: `Sales order deleted - ${orderLabel(existing.order_number, existing.order_date)} (₹${existing.amount}, ${existing.status})`,
    oldValue: `₹${existing.amount} · ${existing.status}`,
    newValue: "Deleted",
    actorId: requestingUserId,
    actorName,
  });
}

// For customer-service.ts's merged Transactions feed - needs the real rows,
// not just a count, so the feed can show order number/status/amount inline
// same as invoices/payments do.
export async function listOrderRowsForCustomer(customerId: string) {
  const result = await pool.query<SalesOrderRow>(
    "SELECT * FROM sales_orders WHERE customer_id = $1 ORDER BY order_date DESC",
    [customerId]
  );
  return result.rows.map(toPublicOrder);
}

export async function countOpenOrders(customerId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM sales_orders WHERE customer_id = $1 AND status = 'confirmed'",
    [customerId]
  );
  return Number(result.rows[0].count);
}
