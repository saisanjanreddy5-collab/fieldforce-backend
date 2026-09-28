import { z } from "zod";

export const decideExpenseClaimSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});
