import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listAssignmentRulesQuerySchema = paginationQuerySchema;

export const createAssignmentRuleSchema = z.object({
  stateId: z.string().uuid(),
  category: z.string().max(100).optional(),
  assignedUserId: z.string().uuid(),
});

export const updateAssignmentRuleSchema = z.object({
  category: z.string().max(100).nullable().optional(),
  assignedUserId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});
