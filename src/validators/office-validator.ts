import { z } from "zod";

const OFFICE_TYPES = ["head_office", "regional_office", "branch"] as const;

export const createOfficeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().optional(),
  code: z.string().optional(),
  type: z.enum(OFFICE_TYPES).optional(),
  address: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  pincode: z.string().optional(),
  zoneId: z.string().uuid().optional(),
  stateId: z.string().uuid().optional(),
  phone: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isActive: z.boolean().optional(),
});

export const updateOfficeSchema = z.object({
  name: z.string().min(1).optional(),
  region: z.string().optional(),
  code: z.string().optional(),
  type: z.enum(OFFICE_TYPES).optional(),
  address: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  pincode: z.string().optional(),
  zoneId: z.string().uuid().or(z.literal("")).optional(),
  stateId: z.string().uuid().or(z.literal("")).optional(),
  phone: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isActive: z.boolean().optional(),
});
