import { z } from "zod";

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Enter something to search for"),
});
