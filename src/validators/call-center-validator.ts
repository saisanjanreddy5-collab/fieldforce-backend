import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

// Read-only, like the module itself - a call row is produced by the
// existing Smartflo click-to-call integration (activities.type='call'),
// never created or edited directly here.
export const listCallsQuerySchema = paginationQuerySchema.extend({
  assignedTo: z.string().uuid().optional(),
});

export const listUpcomingCallsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});
