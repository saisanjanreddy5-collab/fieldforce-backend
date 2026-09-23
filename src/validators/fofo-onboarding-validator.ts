import { z } from "zod";

export const decideStepSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export const updateDocumentStatusSchema = z.object({
  status: z.enum(["verified", "missing", "in_review"]),
  notes: z.string().optional(),
});
