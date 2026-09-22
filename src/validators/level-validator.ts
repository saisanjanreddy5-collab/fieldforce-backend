import { z } from "zod";
import { RECORD_SCOPES } from "../services/level-service";
import { ROLES } from "../utils/roles";

const securityTier = z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT]);
const recordScope = z.enum(RECORD_SCOPES);

export const createLevelSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sortOrder: z.coerce.number().int().optional(),
  description: z.string().optional(),
  headcountLimit: z.coerce.number().int().positive().optional(),
  approvalCeiling: z.coerce.number().nonnegative().optional(),
  securityTier: securityTier.optional(),
  isCrossCutting: z.coerce.boolean().optional(),
  recordScope: recordScope.optional(),
  seesLabelOverride: z.string().optional(),
  approvalLabelOverride: z.string().optional(),
  canEditLabel: z.string().optional(),
  seeCreditFields: z.coerce.boolean().optional(),
  seeMarginFields: z.coerce.boolean().optional(),
  canExport: z.coerce.boolean().optional(),
  canViewCallRecordings: z.coerce.boolean().optional(),
  canSeeUnmaskedPii: z.coerce.boolean().optional(),
});

export const updateLevelSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.coerce.number().int().optional(),
  description: z.string().optional(),
  headcountLimit: z.coerce.number().int().positive().nullable().optional(),
  approvalCeiling: z.coerce.number().nonnegative().nullable().optional(),
  securityTier: securityTier.optional(),
  isCrossCutting: z.coerce.boolean().optional(),
  recordScope: recordScope.optional(),
  seesLabelOverride: z.string().nullable().optional(),
  approvalLabelOverride: z.string().nullable().optional(),
  canEditLabel: z.string().nullable().optional(),
  seeCreditFields: z.coerce.boolean().optional(),
  seeMarginFields: z.coerce.boolean().optional(),
  canExport: z.coerce.boolean().optional(),
  canViewCallRecordings: z.coerce.boolean().optional(),
  canSeeUnmaskedPii: z.coerce.boolean().optional(),
});
