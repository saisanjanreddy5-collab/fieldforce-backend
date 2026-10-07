import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const createSalesTeamSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().optional(),
});

// No filters yet - just the shared page/limit pagination contract.
export const listSalesTeamsQuerySchema = paginationQuerySchema;
