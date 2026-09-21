import { z } from "zod";

export const createSalesTeamSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().optional(),
});
