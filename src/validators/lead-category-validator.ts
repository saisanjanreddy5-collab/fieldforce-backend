import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listLeadCategoriesQuerySchema = paginationQuerySchema;

export const createLeadCategorySchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
});

export const updateLeadCategorySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  description: z.string().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const reorderLeadCategoriesSchema = z.object({
  orderedKeys: z.array(z.string()).min(1),
});
