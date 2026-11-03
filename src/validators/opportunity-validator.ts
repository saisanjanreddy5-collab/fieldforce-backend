import { z } from "zod";

export const convertLeadSchema = z.object({
  name: z.string().optional(),
  value: z.coerce.number().optional(),
  stage: z.string().optional(),
  // YYYY-MM-DD strings sort/compare correctly as plain strings, so this
  // needs no date parsing - just rejects anything before today. Only
  // enforced here, on first setting a close date at conversion - NOT on
  // every later edit (see updateOpportunitySchema below), since a deal's
  // close date naturally slips into the past if nobody touches it, and that
  // must never block saving an unrelated field like value or notes.
  closeDate: z
    .string()
    .optional()
    .refine((v) => !v || v >= new Date().toISOString().slice(0, 10), {
      message: "Expected close date can't be in the past",
    }),
  probability: z.coerce.number().min(0).max(100).optional(),
  contactName: z.string().optional(),
  notes: z.string().optional(),
});

export const updateOpportunitySchema = convertLeadSchema
  .omit({ closeDate: true })
  .partial()
  .extend({ closeDate: z.string().optional() });

export const listOpportunitiesQuerySchema = z.object({
  stage: z.string().optional(),
  leadId: z.string().uuid().optional(),
  category: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  territory: z.string().optional(),
  salesTeamId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(200),
});
