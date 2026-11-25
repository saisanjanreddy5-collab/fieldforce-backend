import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listFofoOnboardingsQuerySchema = paginationQuerySchema;

export const updateDocumentStatusSchema = z.object({
  status: z.enum(["verified", "missing", "in_review"]),
  notes: z.string().optional(),
});
