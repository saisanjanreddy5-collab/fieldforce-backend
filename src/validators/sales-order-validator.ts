import { z } from "zod";
import { decimal12_2 } from "./money";

export const SALES_ORDER_STATUSES = ["confirmed", "delivered", "cancelled"] as const;

export const createSalesOrderSchema = z.object({
  orderDate: z.string().trim().optional(),
  status: z.enum(SALES_ORDER_STATUSES).optional(),
  amount: decimal12_2().positive("Amount must be greater than zero"),
  notes: z.string().trim().max(2000).optional(),
});

export const updateSalesOrderSchema = createSalesOrderSchema.partial();
