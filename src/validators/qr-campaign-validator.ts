import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listQrCampaignsQuerySchema = paginationQuerySchema;

// z.coerce.boolean() runs JS's Boolean(x) - since this form always arrives
// as multipart/form-data, an unchecked box still sends the string "false",
// and Boolean("false") is true (any non-empty string is truthy). That would
// silently record every visitor as having granted consent regardless of
// what they actually checked, corrupting the real consent-rate stat this
// feeds on the Settings tab. This only treats the literal string/boolean
// "true" as true.
const formBoolean = z.preprocess((value) => value === "true" || value === true, z.boolean());

const fieldConfigSchema = z
  .object({
    email: z.boolean().optional(),
    investmentCapacity: z.boolean().optional(),
    existingStore: z.boolean().optional(),
    preferredLanguage: z.boolean().optional(),
    photo: z.boolean().optional(),
  })
  .optional();

export const createQrCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  placement: z.string().max(255).optional(),
  defaultCategory: z.string().min(1).max(100),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  utmTags: z.string().max(255).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  requireConsent: z.boolean().optional(),
  captureScanLocation: z.boolean().optional(),
  fieldConfig: fieldConfigSchema,
});

export const updateQrCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  placement: z.string().max(255).nullable().optional(),
  defaultCategory: z.string().min(1).max(100).optional(),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  utmTags: z.string().max(255).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  requireConsent: z.boolean().optional(),
  captureScanLocation: z.boolean().optional(),
  fieldConfig: fieldConfigSchema,
  status: z.enum(["active", "paused"]).optional(),
});

export const publicSubmitSchema = z.object({
  fullName: z.string().min(1).max(255),
  phone: z.string().min(6).max(20),
  cityOrPincode: z.string().min(1).max(255),
  email: z.string().email().optional().or(z.literal("")),
  investmentCapacity: z.coerce.number().optional(),
  existingStore: formBoolean.optional(),
  preferredLanguage: z.string().max(50).optional(),
  consentGranted: formBoolean,
});
