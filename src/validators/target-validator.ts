import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

const PERIOD_TYPES = ["monthly", "quarterly", "annual"] as const;

export const createTargetSchema = z.object({
  userId: z.string().uuid(),
  periodType: z.enum(PERIOD_TYPES),
  periodAnchor: z.string().min(1, "A date within the target period is required"),
  targetAmount: z.coerce.number().min(0, "Target amount cannot be negative"),
  unitTarget: z.string().optional(),
});

export const updateTargetSchema = z.object({
  periodType: z.enum(PERIOD_TYPES).optional(),
  periodAnchor: z.string().optional(),
  targetAmount: z.coerce.number().min(0, "Target amount cannot be negative").optional(),
  unitTarget: z.string().optional(),
});

export const listTargetsQuerySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
});
