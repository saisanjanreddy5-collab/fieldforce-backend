import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listExpenseTypesQuerySchema = paginationQuerySchema;

// Mobile API handoff - "pick a month, optionally one person, see every
// claim in my reporting chain". from/to are plain ISO dates (YYYY-MM-DD) so
// a whole month is just that month's first and last day, not a special
// "month" concept of its own.
export const searchExpenseClaimsQuerySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
});

export const decideExpenseClaimSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});
