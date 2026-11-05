import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const createDelegationSchema = z.object({
  userId: z.string().uuid(),
  delegateId: z.string().uuid(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
});

// Query-string booleans arrive as the literal strings "true"/"false" (or are
// absent) - z.coerce.boolean() would treat "false" as truthy since any
// non-empty string coerces to true, so this maps the two real string values
// explicitly instead. Same helper as lead-validator.ts's own queryBoolean.
const queryBoolean = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const listDelegationsQuerySchema = paginationQuerySchema.extend({
  archived: queryBoolean,
});
