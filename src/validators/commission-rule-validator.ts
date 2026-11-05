import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

// Query-string booleans arrive as the literal strings "true"/"false" (or are
// absent) - same reasoning lead-validator.ts's own queryBoolean documents.
const queryBoolean = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const createCommissionRuleSchema = z.object({
  incentivePlanId: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  ruleType: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const updateCommissionRuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  ruleType: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const listCommissionRulesQuerySchema = paginationQuerySchema.extend({
  incentivePlanId: z.string().uuid().optional(),
  archived: queryBoolean,
});
