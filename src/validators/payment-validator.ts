import { z } from "zod";
import { decimal12_2 } from "./money";

export const PAYMENT_STATUSES = ["cleared", "pending", "bounced"] as const;

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid().nullable().optional(),
  paymentDate: z.string().trim().optional(),
  method: z.string().trim().max(50).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  amount: decimal12_2().positive("Amount must be greater than zero"),
});

export const updatePaymentSchema = createPaymentSchema.partial();
