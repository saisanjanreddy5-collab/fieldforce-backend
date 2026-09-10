import { z } from "zod";

export const checkInSchema = z.object({
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

export const checkOutSchema = z.object({
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

export const locationPingSchema = z.object({
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
});
