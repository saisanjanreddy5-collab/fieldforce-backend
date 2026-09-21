import { z } from "zod";

export const createDelegationSchema = z.object({
  userId: z.string().uuid(),
  delegateId: z.string().uuid(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
});
