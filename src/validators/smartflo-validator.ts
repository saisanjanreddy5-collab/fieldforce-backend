import { z } from "zod";

// Both optional - with neither, the call dials the lead's own registered
// phone exactly as before. contactName is display-only (goes into the
// logged Activity's subject so the record shows who was actually reached,
// not just "Click-to-call" with no way to tell which contact it was).
export const callLeadSchema = z.object({
  phone: z.string().trim().min(1).optional(),
  contactName: z.string().trim().min(1).max(255).optional(),
});
