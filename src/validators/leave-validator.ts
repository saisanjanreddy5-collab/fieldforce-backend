import { z } from "zod";
import { LEAVE_REQUEST_KINDS } from "../services/leave-service";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

export const createLeaveRequestSchema = z.object({
  kind: z.enum(LEAVE_REQUEST_KINDS),
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().min(1, "Reason is required").max(500),
  coverUserId: z.string().uuid().optional(),
});

export const decideLeaveRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export const grantCompOffSchema = z.object({
  userId: z.string().uuid(),
  earnedDate: isoDate,
  reason: z.string().max(255).optional(),
});
