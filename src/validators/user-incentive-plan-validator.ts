import { z } from "zod";

export const createUserIncentivePlanSchema = z.object({
  userId: z.string().uuid(),
  incentivePlanId: z.string().uuid(),
  effectiveStartDate: z.string().min(1, "Effective start date is required"),
  effectiveEndDate: z.string().optional(),
  rate: z.string().optional(),
  capPerCycle: z.number().nonnegative().optional(),
  paysFromAttainmentPercent: z.number().min(0).max(1000).optional(),
});

export const listUserIncentivePlansQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});
