import { z } from "zod";

export const convertLeadSchema = z.object({
  name: z.string().optional(),
  value: z.coerce.number().optional(),
  stage: z.string().optional(),
  closeDate: z.string().optional(),
  probability: z.coerce.number().min(0).max(100).optional(),
  contactName: z.string().optional(),
  notes: z.string().optional(),
});

export const updateOpportunitySchema = convertLeadSchema.partial();

export const listOpportunitiesQuerySchema = z.object({
  stage: z.string().optional(),
  leadId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
