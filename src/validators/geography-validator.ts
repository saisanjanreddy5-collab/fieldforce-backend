import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listZonesQuerySchema = paginationQuerySchema;

export const listStatesQuerySchema = paginationQuerySchema.extend({
  zoneId: z.string().uuid().optional(),
});
