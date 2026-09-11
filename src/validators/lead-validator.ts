import { z } from "zod";

const uuid = z.string().uuid();

const consentInputSchema = z.object({
  captured: z.boolean().optional(),
  method: z.string().optional(),
  purposes: z.string().optional(),
  evidenceRef: z.string().optional(),
  notes: z.string().optional(),
});

export const createLeadSchema = z.object({
  // Customer tab
  fullName: z.string().min(1, "Full name is required"),
  contactName: z.string().optional(),
  profession: z.string().optional(),
  startDate: z.string().optional(),
  qualifiedPerson: z.string().optional(),
  financialStatus: z.string().optional(),
  welcomeMessageSent: z.boolean().optional(),
  status: z.string().optional(),
  prospectStatus: z.string().optional(),
  category: z.string().optional(),
  ownerId: uuid.optional(),
  salesTeamId: uuid.optional(),
  leadScore: z.coerce.number().min(0).max(100).optional(),

  // Contact tab
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().optional(),
  preferredLanguage: z.string().optional(),
  pincode: z.string().optional(),
  zoneId: uuid.optional(),
  stateId: uuid.optional(),
  districtId: uuid.optional(),
  areaId: uuid.optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  territory: z.string().optional(),

  // Inquiry tab
  companyName: z.string().optional(),
  source: z.string().optional(),
  inquiryCategory: z.string().optional(),
  inquirySource: z.string().optional(),
  captureChannel: z.string().optional(),
  utmTags: z.string().optional(),
  campaignId: uuid.optional(),
  expectedValue: z.coerce.number().optional(),
  receivedAt: z.string().optional(),
  internalNotes: z.string().optional(),
  rmRemark: z.string().optional(),
  lgRemark: z.string().optional(),

  // Store tab
  hasStoreLocation: z.boolean().optional(),
  storeName: z.string().optional(),
  storeAddress: z.string().optional(),
  storePincode: z.string().optional(),
  storeCity: z.string().optional(),
  storeState: z.string().optional(),
  carpetArea: z.string().optional(),
  frontage: z.string().optional(),
  ownership: z.string().optional(),
  investmentCapacity: z.coerce.number().optional(),
  existingBusiness: z.string().optional(),
  expectedOpening: z.string().optional(),
  gstNumber: z.string().optional(),
  panNumber: z.string().optional(),
  drugLicenceNumber: z.string().optional(),
  fssaiNumber: z.string().optional(),

  // Consent tab - written to the separate consents table
  consent: consentInputSchema.optional(),
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
