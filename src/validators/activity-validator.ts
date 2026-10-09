import { z } from "zod";

// Kept in sync with the activities_type_check CHECK constraint in model.ts -
// a type allowed there but missing here means rows can be created (activity
// creation doesn't go through this schema) but never filtered by via
// GET /activities?type=..., which does.
export const ACTIVITY_TYPES = ["call", "email", "teams_meeting", "site_visit", "whatsapp", "internal", "support_ticket"] as const;

export const createActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  externalRefId: z.string().optional(),
});

export const updateActivitySchema = z.object({
  subject: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  externalRefId: z.string().optional(),
});

export const addCommentSchema = z.object({
  comment: z.string().min(1, "Comment cannot be empty"),
});

export const listActivitiesQuerySchema = z.object({
  type: z.enum(ACTIVITY_TYPES).optional(),
  leadId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  status: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const calendarViewQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});
