import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const createUserIncentivePlanSchema = z.object({
  userId: z.string().uuid(),
  incentivePlanId: z.string().uuid(),
  effectiveStartDate: z.string().min(1, "Effective start date is required"),
  effectiveEndDate: z.string().optional(),
  rate: z.string().optional(),
  capPerCycle: z.number().nonnegative().optional(),
  paysFromAttainmentPercent: z.number().min(0).max(1000).optional(),
});

// Query-string booleans arrive as the literal strings "true"/"false" (or
// are absent) - z.coerce.boolean() would treat "false" as truthy since any
// non-empty string coerces to true, so this maps the two real string
// values explicitly instead.
const queryBoolean = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const listUserIncentivePlansQuerySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
  archived: queryBoolean,
});
