import { z } from "zod";

export const createSavedViewSchema = z.object({
  reportKey: z.enum(["salesperson", "state_wise", "b2b_group", "lead_source_roi", "fofo_cohort_retention"]),
  name: z.string().min(1, "Name is required").max(150),
  filters: z.record(z.string(), z.unknown()).default({}),
});
