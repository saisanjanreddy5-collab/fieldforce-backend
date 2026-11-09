import { z } from "zod";

export const ADDRESS_TYPES = ["billing", "shipping"] as const;

export const createAddressSchema = z.object({
  type: z.enum(ADDRESS_TYPES),
  label: z.string().trim().max(150).optional(),
  addressLine1: z.string().trim().min(1, "Address is required").max(255),
  addressLine2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  // Same reasoning as lead-validator.ts's own pincode field: blank is fine,
  // but a non-blank value must be a real 6-digit Indian pincode.
  pincode: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{6}$/.test(v), "Enter a valid 6-digit pincode")
    .optional(),
});

export const updateAddressSchema = createAddressSchema.partial();
