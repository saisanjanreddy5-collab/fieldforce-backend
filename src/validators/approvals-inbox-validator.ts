import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

// paginationQuerySchema's own limit caps at 200, sized for the mobile list
// endpoints it was built for. The Approvals History tab is different: every
// past decision must stay reachable, and the three source queries it merges
// are already capped at a generous 10,000 rows each (see leave-service's/
// expense-service's/fofo-onboarding-service's listDecidedByUser /
// listDecidedStepsByUser), so this just needs a ceiling high enough to
// request the whole merged set in one call.
export const approvalHistoryQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(30000).default(30000),
});
