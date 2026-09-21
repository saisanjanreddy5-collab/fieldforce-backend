import { z } from "zod";

export const createIncentivePlanSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  effectiveStartDate: z.string().min(1, "Effective start date is required"),
  effectiveEndDate: z.string().optional(),
});

export const updateIncentivePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  effectiveStartDate: z.string().optional(),
  effectiveEndDate: z.string().optional(),
});
