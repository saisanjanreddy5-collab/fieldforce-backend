import { z } from "zod";

// Shared across every list endpoint being paginated for the mobile API
// handoff - one page/limit convention so the mobile client writes a single
// list-fetching helper instead of special-casing each module. Same default
// shape leads already used (lead-validator.ts's listLeadsQuerySchema) before
// this existed as its own file; leads keeps its own inline copy rather than
// importing this one, so this is purely additive, not a refactor of working
// code.
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
