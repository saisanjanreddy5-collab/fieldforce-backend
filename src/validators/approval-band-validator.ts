import { z } from "zod";
import { REQUEST_TYPES } from "../services/approval-band-service";

export const createApprovalBandSchema = z.object({
  requestType: z.enum(REQUEST_TYPES),
  bandName: z.string().min(1, "Band name is required"),
  rangeFrom: z.number().min(0).optional(),
  rangeTo: z.number().min(0).optional(),
  approverLevelId: z.string().uuid().optional(),
  countersignedByLevelId: z.string().uuid().optional(),
  slaHours: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
});

export const updateApprovalBandSchema = z.object({
  bandName: z.string().min(1).optional(),
  rangeFrom: z.number().min(0).optional(),
  rangeTo: z.number().min(0).nullable().optional(),
  approverLevelId: z.string().uuid().nullable().optional(),
  countersignedByLevelId: z.string().uuid().nullable().optional(),
  slaHours: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
