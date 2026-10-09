import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const createSupportTicketSchema = z.object({
  leadId: z.string().uuid(),
  subject: z.string().trim().min(1, "Subject is required").max(255),
  description: z.string().trim().max(10000).optional(),
});

export const replySupportTicketSchema = z.object({
  message: z.string().trim().min(1, "Reply can't be empty").max(10000),
});

export const listSupportTicketsQuerySchema = paginationQuerySchema.extend({
  leadId: z.string().uuid().optional(),
});
