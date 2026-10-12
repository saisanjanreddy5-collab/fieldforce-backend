import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

// Real values confirmed against the Frappe site's own HD Ticket Priority /
// HD Ticket Status records (GET /api/resource/HD Ticket Priority, etc.),
// not guessed - both are configurable Link doctypes on Frappe's side, so
// this list is only as current as what's configured there today.
export const TICKET_PRIORITIES = ["Urgent", "High", "Medium", "Low"] as const;
export const TICKET_STATUSES = ["Open", "Replied", "Resolved", "Closed"] as const;

export const createSupportTicketSchema = z.object({
  leadId: z.string().uuid(),
  subject: z.string().trim().min(1, "Subject is required").max(255),
  description: z.string().trim().max(10000).optional(),
  priority: z.enum(TICKET_PRIORITIES),
});

export const replySupportTicketSchema = z.object({
  message: z.string().trim().min(1, "Reply can't be empty").max(10000),
});

export const updateSupportTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});

export const listSupportTicketsQuerySchema = paginationQuerySchema.extend({
  leadId: z.string().uuid().optional(),
});
