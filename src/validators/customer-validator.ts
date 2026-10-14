import { z } from "zod";
import { paginationQuerySchema } from "./pagination";
import { decimal12_2 } from "./money";

export const CUSTOMER_STATUSES = ["active", "inactive", "on_hold"] as const;
export const CREDIT_CATEGORIES = ["A", "B", "C", "D"] as const;

// No create schema - a customer is never created directly, only produced by
// a lead's status changing to 'converted' (see lead-service.ts). What's
// editable afterward is ownership, status, and the real manual financial
// fields; identity/geography stay as carried over from the lead.
export const updateCustomerSchema = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  creditLimit: decimal12_2().min(0).optional(),
  outstandingBalance: decimal12_2().min(0).optional(),
  creditCategory: z.enum(CREDIT_CATEGORIES).nullable().optional(),
});

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
});
