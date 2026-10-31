import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isCustomerInScope } from "./customer-service";
import { recordAuditEvent } from "./audit-log-service";

interface InvoiceRow {
  id: string;
  invoice_number: number;
  customer_id: string;
  sales_order_id: string | null;
  invoice_date: string;
  due_date: string | null;
  status: string;
  amount: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

// Year comes from the invoice's own invoice_date, not "now" - see
// sales-order-service.ts's orderLabel for the full reasoning (same bug,
// same fix, three sibling services).
export function invoiceLabel(invoiceNumber: number, invoiceDate: string): string {
  return `INV-${invoiceDate.slice(0, 4)}-${String(invoiceNumber).padStart(4, "0")}`;
}

// Overdue is computed here, not stored - same reasoning leads/activities'
// own has_overdue_activity already uses, so it can never drift stale.
// due_date is a DATE column (calendar day, no time-of-day) - compared as a
// plain "YYYY-MM-DD" string against today's own date-only string, matching
// countOverdueInvoices' SQL-side `due_date < CURRENT_DATE` exactly. The
// previous `new Date(due_date) < new Date()` compared a UTC-midnight
// timestamp against the current instant, which disagreed with that SQL
// comparison for any invoice due today (true here almost the entire day,
// false in SQL until tomorrow) - same invoice, same screen, contradicting
// itself between the Transactions feed and the Overview tab.
function isOverdue(row: InvoiceRow): boolean {
  if (row.status === "paid" || row.due_date === null) return false;
  // IST, not UTC - the Postgres connection's own session timezone is
  // Asia/Calcutta (confirmed via `SHOW timezone`), which is what
  // countOverdueInvoices' CURRENT_DATE actually evaluates against. Using
  // UTC here would just trade one disagreement for another.
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return row.due_date < todayIST;
}

function toPublicInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceLabel: invoiceLabel(row.invoice_number, row.invoice_date),
    customerId: row.customer_id,
    salesOrderId: row.sales_order_id,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    status: row.status,
    isOverdue: isOverdue(row),
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

// Without this, a salesOrderId belonging to a DIFFERENT customer passes
// the foreign key check fine (any real sales_orders.id satisfies it) and
// silently cross-links two unrelated customers' transaction records -
// not a visibility bypass (the caller already has access to this
// invoice's own customer), just real data corruption with no error raised.
async function assertSalesOrderBelongsToCustomer(salesOrderId: string, customerId: string): Promise<void> {
  const result = await pool.query("SELECT 1 FROM sales_orders WHERE id = $1 AND customer_id = $2 AND is_deleted = false", [
    salesOrderId,
    customerId,
  ]);
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(422, "That sales order does not belong to this customer");
  }
}

export async function listInvoicesForCustomer(customerId: string, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<InvoiceRow>(
    "SELECT * FROM invoices WHERE customer_id = $1 AND is_deleted = false ORDER BY invoice_date DESC, created_at DESC",
    [customerId]
  );
  return result.rows.map(toPublicInvoice);
}

export interface InvoiceInput {
  salesOrderId?: string | null;
  invoiceDate?: string;
  dueDate?: string;
  status?: string;
  amount: number;
}

export async function createInvoice(customerId: string, input: InvoiceInput, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  if (input.salesOrderId) {
    await assertSalesOrderBelongsToCustomer(input.salesOrderId, customerId);
  }
  const result = await pool.query<InvoiceRow>(
    `INSERT INTO invoices (customer_id, sales_order_id, invoice_date, due_date, status, amount, created_by)
     VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, COALESCE($5,'unpaid'), $6, $7)
     RETURNING *`,
    [customerId, input.salesOrderId ?? null, input.invoiceDate ?? null, input.dueDate ?? null, input.status ?? null, input.amount, requestingUserId]
  );
  return toPublicInvoice(result.rows[0]);
}

async function getInvoiceOrThrow(invoiceId: string): Promise<InvoiceRow> {
  const result = await pool.query<InvoiceRow>("SELECT * FROM invoices WHERE id = $1 AND is_deleted = false", [invoiceId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Invoice not found");
  }
  return result.rows[0];
}

export async function updateInvoice(invoiceId: string, input: Partial<InvoiceInput>, requestingUserId: string) {
  const existing = await getInvoiceOrThrow(invoiceId);
  await assertInScope(existing.customer_id, requestingUserId);
  if (input.salesOrderId) {
    await assertSalesOrderBelongsToCustomer(input.salesOrderId, existing.customer_id);
  }

  const fieldMap: Record<string, unknown> = {
    sales_order_id: input.salesOrderId,
    invoice_date: input.invoiceDate,
    due_date: input.dueDate,
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
  if (setClauses.length === 0) return toPublicInvoice(existing);

  setClauses.push("updated_at = now()");
  params.push(invoiceId);
  const result = await pool.query<InvoiceRow>(
    `UPDATE invoices SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicInvoice(result.rows[0]);
}

export async function deleteInvoice(invoiceId: string, requestingUserId: string): Promise<void> {
  const existing = await getInvoiceOrThrow(invoiceId);
  await assertInScope(existing.customer_id, requestingUserId);
  await pool.query("UPDATE invoices SET is_deleted = true WHERE id = $1 AND is_deleted = false", [invoiceId]);

  // Archives rather than destroys the row - "data is king" - same
  // is_deleted convention as leads/opportunities. The audit entry below
  // still matters just as much as it did when this was a real DELETE: it's
  // the one place that records who archived a real financial record and
  // when, matching the seriousness updateCustomer's own credit/balance
  // changes already get.
  const actorName = (await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId])).rows[0]?.name ?? null;
  await recordAuditEvent({
    entityType: "invoice",
    entityId: invoiceId,
    entityLabel: invoiceLabel(existing.invoice_number, existing.invoice_date),
    action: "deleted",
    summary: `Invoice deleted - ${invoiceLabel(existing.invoice_number, existing.invoice_date)} (₹${existing.amount}, ${existing.status})`,
    oldValue: `₹${existing.amount} · ${existing.status}`,
    newValue: "Deleted",
    actorId: requestingUserId,
    actorName,
  });
}

export async function listInvoiceRowsForCustomer(customerId: string) {
  const result = await pool.query<InvoiceRow>(
    "SELECT * FROM invoices WHERE customer_id = $1 AND is_deleted = false ORDER BY invoice_date DESC",
    [customerId]
  );
  return result.rows.map(toPublicInvoice);
}

export async function countOverdueInvoices(customerId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM invoices WHERE customer_id = $1 AND is_deleted = false AND status <> 'paid' AND due_date IS NOT NULL AND due_date < CURRENT_DATE",
    [customerId]
  );
  return Number(result.rows[0].count);
}
