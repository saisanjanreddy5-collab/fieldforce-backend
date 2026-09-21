import { z } from "zod";

export const createOverrideSchema = z.object({
  userId: z.string().uuid(),
  permission: z.string().min(1),
  grantType: z.enum(["grant", "revoke"]),
  reason: z.string().max(255).optional(),
  expiresAt: z.string().optional(),
});
