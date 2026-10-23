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

export const logCallDispositionSchema = z
  .object({
    disposition: z.enum(CALL_DISPOSITIONS),
    notes: z.string().optional(),
    // Only meaningful (and only required) when disposition is "Call Back" -
    // real datetime the rep picked for when to try this person again. This
    // is what actually schedules the follow-up (a new, separate pending
    // Activity - see logCallDisposition in lead-call-center-service.ts),
    // not just free text saying "call back" with nothing tracking when.
    callbackAt: z.string().datetime().optional(),
  })
  .refine((v) => v.disposition !== "Call Back" || v.callbackAt !== undefined, {
    message: "Pick when to call back",
    path: ["callbackAt"],
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
