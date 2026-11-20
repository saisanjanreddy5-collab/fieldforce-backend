import { z } from "zod";

export const createSavedViewSchema = z.object({
  reportKey: z.enum([
    "salesperson",
    "state_wise",
    "b2b_group",
    "lead_source_roi",
    "fofo_cohort_retention",
    "call_center_performance",
    "field_sales_performance",
  ]),
  name: z.string().min(1, "Name is required").max(150),
  filters: z.record(z.string(), z.unknown()).default({}),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const salespersonReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use a YYYY-MM month").optional(),
  zoneId: z.uuid().optional(),
});

// employeeIds: a comma-separated list of user ids.
export const performanceReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  employeeIds: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).optional()),
});

export const savedViewsQuerySchema = z.object({
  reportKey: createSavedViewSchema.shape.reportKey,
});
