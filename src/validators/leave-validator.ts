import { z } from "zod";
import { LEAVE_REQUEST_KINDS } from "../services/leave-service";
import { paginationQuerySchema } from "./pagination";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

export const listLeaveTypesQuerySchema = paginationQuerySchema;

// Mobile API handoff - "pick any month, optionally one person, see every
// request in my reporting chain". Plain ISO dates, same convention as the
// expense claims search - a whole month is just that month's first/last day.
export const searchLeaveRequestsQuerySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

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

export const updateLeaveTypeSchema = z.object({
  annualDays: z.coerce.number().min(0).nullable().optional(),
  accrualPerMonth: z.coerce.number().min(0).nullable().optional(),
  carryForwardCap: z.coerce.number().min(0).nullable().optional(),
  maxConsecutiveDays: z.coerce.number().int().min(0).nullable().optional(),
  noticeDays: z.coerce.number().int().min(0).nullable().optional(),
  medicalNoteAfterDays: z.coerce.number().int().min(0).nullable().optional(),
  expiresAfterDays: z.coerce.number().int().min(0).nullable().optional(),
  requiresSecondApprover: z.boolean().optional(),
  policyNote: z.string().min(1).max(200).optional(),
});
