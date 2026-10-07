import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

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
});
