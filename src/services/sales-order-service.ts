import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isCustomerInScope } from "./customer-service";

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

export function orderLabel(orderNumber: number): string {
  return `SO-${new Date().getFullYear()}-${String(orderNumber).padStart(4, "0")}`;
}

function toPublicOrder(row: SalesOrderRow) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    orderLabel: orderLabel(row.order_number),
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
