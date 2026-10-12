import { z } from "zod";

export const createContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  role: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(255).optional(),
  isPrimary: z.boolean().optional(),
});

export const updateContactSchema = createContactSchema.partial();
