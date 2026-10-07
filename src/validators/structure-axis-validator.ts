import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const updateStructureAxisSchema = z.object({
  isEnabled: z.boolean(),
});

// No filters yet - just the shared page/limit pagination contract.
export const listStructureAxesQuerySchema = paginationQuerySchema;
