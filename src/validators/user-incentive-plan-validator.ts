import { z } from "zod";

export const createUserIncentivePlanSchema = z.object({
  userId: z.string().uuid(),
  incentivePlanId: z.string().uuid(),
  effectiveStartDate: z.string().min(1, "Effective start date is required"),
  effectiveEndDate: z.string().optional(),
});

export const listUserIncentivePlansQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});
