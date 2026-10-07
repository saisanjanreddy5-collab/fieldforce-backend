import { z } from "zod";
import { TEMPLATE_CHANNELS } from "../services/message-template-service";
import { paginationQuerySchema } from "./pagination";

export const listMessageTemplatesQuerySchema = paginationQuerySchema.extend({
  channel: z.enum(TEMPLATE_CHANNELS).optional(),
});

export const createMessageTemplateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only"),
  name: z.string().min(1).max(150),
  channel: z.enum(TEMPLATE_CHANNELS),
  triggerNote: z.string().max(200).optional(),
  subject: z.string().max(255).optional(),
  body: z.string().min(1),
  status: z.enum(["active", "draft"]).optional(),
});

export const updateMessageTemplateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  triggerNote: z.string().max(200).nullable().optional(),
  subject: z.string().max(255).nullable().optional(),
  body: z.string().min(1).optional(),
  status: z.enum(["active", "draft"]).optional(),
});
