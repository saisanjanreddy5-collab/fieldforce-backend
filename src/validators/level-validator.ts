import { z } from "zod";

export const createLevelSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sortOrder: z.coerce.number().int().optional(),
});
