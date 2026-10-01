import { z } from "zod";

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  taxPercent: z.coerce.number().min(0).max(100),
});

export const createQuoteSchema = z.object({
  leadId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item"),
  notes: z.string().optional(),
});

export const updateQuoteSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item"),
  notes: z.string().optional(),
  changeSummary: z.string().optional(),
});

export const updateQuoteStatusSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "rejected"]),
});

export const listQuotesQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});
