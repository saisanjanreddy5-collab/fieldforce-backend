import { z } from "zod";

export const ACTIVITY_TYPES = ["call", "email", "teams_meeting", "site_visit"] as const;

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
