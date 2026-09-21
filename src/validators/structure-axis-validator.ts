import { z } from "zod";

export const updateStructureAxisSchema = z.object({
  isEnabled: z.boolean(),
});
