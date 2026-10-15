import { z } from "zod";

export const sendLeadEmailSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  // Optional override for a specific contact's own email (e.g. a customer
  // contact who isn't the lead itself) - when absent, sendMailForLead falls
  // back to the lead's own email on file exactly as before.
  toEmail: z.string().email().optional(),
  // Comma-separated list, not a real array - see sendMailForLead's own
  // comment for why (this request is multipart/form-data for attachments).
  ccEmails: z.string().optional(),
});

export const createTeamsMeetingSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
});
