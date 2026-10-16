import { z } from "zod";

// The business's own real call-disposition values, taken directly from
// their existing manual call-tracking spreadsheet - not invented here.
export const CALL_DISPOSITIONS = [
  "Ringing",
  "Not Reachable",
  "Switched Off",
  "Language",
  "Call Back",
  "Call Done And Interested",
  "Call Done And Not Interested",
] as const;

export const logCallDispositionSchema = z.object({
  disposition: z.enum(CALL_DISPOSITIONS),
  notes: z.string().optional(),
});

export const sendToFieldSchema = z.object({
  // Only required when more than one field employee covers the lead's
  // pincode - GET /leads/:id/swap-candidates lists them so the caller can
  // pick one; omitted when there's exactly one obvious match.
  ownerId: z.string().uuid().optional(),
});

export const reassignLeadSchema = z.object({
  ownerId: z.string().uuid(),
});
