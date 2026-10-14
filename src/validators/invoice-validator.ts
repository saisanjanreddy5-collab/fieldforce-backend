import { z } from "zod";
import { decimal12_2 } from "./money";

export const INVOICE_STATUSES = ["unpaid", "partially_paid", "paid"] as const;

export const createInvoiceSchema = z.object({
  salesOrderId: z.string().uuid().nullable().optional(),
  invoiceDate: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  amount: decimal12_2().positive("Amount must be greater than zero"),
});

export const updateInvoiceSchema = createInvoiceSchema.partial();
