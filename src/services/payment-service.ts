import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isCustomerInScope } from "./customer-service";

interface PaymentRow {
  id: string;
  receipt_number: number;
  customer_id: string;
  invoice_id: string | null;
  payment_date: string;
  method: string | null;
  status: string;
  amount: string;
  created_at: string;
  updated_at: string;
}

export function receiptLabel(receiptNumber: number): string {
  return `RCPT-${new Date().getFullYear()}-${String(receiptNumber).padStart(4, "0")}`;
}

function toPublicPayment(row: PaymentRow) {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    receiptLabel: receiptLabel(row.receipt_number),
    customerId: row.customer_id,
    invoiceId: row.invoice_id,
    paymentDate: row.payment_date,
    method: row.method,
    status: row.status,
    amount: Number(row.amount),
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

export async function listPaymentsForCustomer(customerId: string, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<PaymentRow>(
    "SELECT * FROM payments WHERE customer_id = $1 ORDER BY payment_date DESC, created_at DESC",
    [customerId]
  );
  return result.rows.map(toPublicPayment);
}

export interface PaymentInput {
  invoiceId?: string | null;
  paymentDate?: string;
  method?: string;
  status?: string;
  amount: number;
}

export async function createPayment(customerId: string, input: PaymentInput, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<PaymentRow>(
    `INSERT INTO payments (customer_id, invoice_id, payment_date, method, status, amount, created_by)
     VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, COALESCE($5,'cleared'), $6, $7)
     RETURNING *`,
    [customerId, input.invoiceId ?? null, input.paymentDate ?? null, input.method ?? null, input.status ?? null, input.amount, requestingUserId]
  );
  return toPublicPayment(result.rows[0]);
}

async function getPaymentOrThrow(paymentId: string): Promise<PaymentRow> {
  const result = await pool.query<PaymentRow>("SELECT * FROM payments WHERE id = $1", [paymentId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Payment not found");
  }
  return result.rows[0];
}

export async function updatePayment(paymentId: string, input: Partial<PaymentInput>, requestingUserId: string) {
  const existing = await getPaymentOrThrow(paymentId);
  await assertInScope(existing.customer_id, requestingUserId);

  const fieldMap: Record<string, unknown> = {
    invoice_id: input.invoiceId,
    payment_date: input.paymentDate,
    method: input.method,
    status: input.status,
    amount: input.amount,
  };
  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }
  if (setClauses.length === 0) return toPublicPayment(existing);

  setClauses.push("updated_at = now()");
  params.push(paymentId);
  const result = await pool.query<PaymentRow>(
    `UPDATE payments SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicPayment(result.rows[0]);
}

export async function deletePayment(paymentId: string, requestingUserId: string): Promise<void> {
  const existing = await getPaymentOrThrow(paymentId);
  await assertInScope(existing.customer_id, requestingUserId);
  await pool.query("DELETE FROM payments WHERE id = $1", [paymentId]);
}

export async function listPaymentRowsForCustomer(customerId: string) {
  const result = await pool.query<PaymentRow>(
    "SELECT * FROM payments WHERE customer_id = $1 ORDER BY payment_date DESC",
    [customerId]
  );
  return result.rows.map(toPublicPayment);
}

// "Lifetime value" on the Overview tab - real money actually received, not
// just invoiced/ordered, so a cancelled order or a bounced/pending payment
// never counts toward it.
export async function sumClearedPayments(customerId: string): Promise<number> {
  const result = await pool.query<{ sum: string | null }>(
    "SELECT SUM(amount) AS sum FROM payments WHERE customer_id = $1 AND status = 'cleared'",
    [customerId]
  );
  return Number(result.rows[0].sum ?? 0);
}
