import { z } from "zod";

const uuid = z.string().uuid();

export const createLeadSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().optional(),
  preferredLanguage: z.string().optional(),
  companyName: z.string().optional(),
  profession: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  inquiryCategory: z.string().optional(),
  inquirySource: z.string().optional(),
  captureChannel: z.string().optional(),
  utmTags: z.string().optional(),
  campaignId: uuid.optional(),
  expectedValue: z.coerce.number().optional(),
  status: z.string().optional(),
  prospectStatus: z.string().optional(),
  ownerId: uuid.optional(),
  salesTeamId: uuid.optional(),
  zoneId: uuid.optional(),
  stateId: uuid.optional(),
  districtId: uuid.optional(),
  areaId: uuid.optional(),
  pincode: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  territory: z.string().optional(),
  internalNotes: z.string().optional(),
  rmRemark: z.string().optional(),
  lgRemark: z.string().optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const shareLeadSchema = z.object({
  userId: uuid,
});

export const listLeadsQuerySchema = z.object({
  status: z.string().optional(),
  ownerId: uuid.optional(),
  zoneId: uuid.optional(),
  stateId: uuid.optional(),
  districtId: uuid.optional(),
  areaId: uuid.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
