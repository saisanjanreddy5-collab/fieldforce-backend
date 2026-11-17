import { z } from "zod";

export const createContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  role: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(20).optional(),
  // Lowercased like a lead's email - the same address must never look like
  // two different ones depending on how it was typed.
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  isPrimary: z.boolean().optional(),
});

export const updateContactSchema = createContactSchema.partial();
