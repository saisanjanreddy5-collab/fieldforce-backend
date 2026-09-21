import { z } from "zod";

export const createOfficeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().optional(),
  code: z.string().optional(),
  address: z.string().optional(),
  zoneId: z.string().uuid().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const updateOfficeSchema = z.object({
  name: z.string().min(1).optional(),
  region: z.string().optional(),
  code: z.string().optional(),
  address: z.string().optional(),
  zoneId: z.string().uuid().or(z.literal("")).optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});
