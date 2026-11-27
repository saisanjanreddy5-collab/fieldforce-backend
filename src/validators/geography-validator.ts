import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listZonesQuerySchema = paginationQuerySchema;

export const listStatesQuerySchema = paginationQuerySchema.extend({
  zoneId: z.string().uuid().optional(),
});

// Dropdowns - not paginated: one state has at most a few dozen cities, and
// one city a few hundred to ~1,500 areas.
const searchSchema = z.string().trim().min(1).max(100).optional();

export const listCitiesQuerySchema = z.object({
  stateId: z.string().uuid(),
  search: searchSchema,
});

export const listAreasQuerySchema = z
  .object({
    cityId: z.string().uuid().optional(),
    pincode: z.string().regex(/^\d{6}$/, "Pincode must be 6 digits").optional(),
    search: searchSchema,
  })
  .refine((q) => q.cityId || q.pincode, { message: "cityId or pincode is required", path: ["cityId"] });
