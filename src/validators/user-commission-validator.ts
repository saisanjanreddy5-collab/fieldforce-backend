import { z } from "zod";
import { COMMISSION_BASES, PAYOUT_CYCLES } from "../services/user-commission-service";

export const createUserCommissionSchema = z.object({
  userId: z.string().uuid(),
  basis: z.enum(COMMISSION_BASES),
  rate: z.string().optional(),
  appliesTo: z.string().optional(),
  payoutCycle: z.enum(PAYOUT_CYCLES),
});

export const listUserCommissionsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});
