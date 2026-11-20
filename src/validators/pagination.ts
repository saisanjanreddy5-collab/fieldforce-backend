import { z } from "zod";

// One page/limit convention for paginated list endpoints, so a client can use
// a single list-fetching helper. The Leads list is the exception: its
// listLeadsQuerySchema has its own, smaller limits (default 20, max 100).
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

