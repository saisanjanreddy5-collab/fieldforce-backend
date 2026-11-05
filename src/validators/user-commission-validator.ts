import { z } from "zod";
import { COMMISSION_BASES, PAYOUT_CYCLES } from "../services/user-commission-service";
import { paginationQuerySchema } from "./pagination";

export const createUserCommissionSchema = z.object({
  userId: z.string().uuid(),
  basis: z.enum(COMMISSION_BASES),
  rate: z.string().optional(),
  appliesTo: z.string().optional(),
  payoutCycle: z.enum(PAYOUT_CYCLES),
});

// Query-string booleans arrive as the literal strings "true"/"false" (or
// are absent) - z.coerce.boolean() would treat "false" as truthy since any
// non-empty string coerces to true, so this maps the two real string
// values explicitly instead.
const queryBoolean = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const listUserCommissionsQuerySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
  archived: queryBoolean,
});
