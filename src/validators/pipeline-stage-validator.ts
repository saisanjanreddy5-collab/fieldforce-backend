import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listPipelineStagesQuerySchema = paginationQuerySchema;

export const createPipelineStageSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
  probability: z.coerce.number().int().min(0).max(100),
});

export const updatePipelineStageSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  description: z.string().max(255).nullable().optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const reorderPipelineStagesSchema = z.object({
  orderedKeys: z.array(z.string()).min(1),
});
