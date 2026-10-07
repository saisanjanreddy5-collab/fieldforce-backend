import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listWebsiteLeadSourcesQuerySchema = paginationQuerySchema;

// z.coerce.boolean() runs JS's Boolean(x) - a string "false" (which is what
// a plain HTML form or a non-JSON client would send) is truthy under that
// coercion, silently recording every submission as consenting regardless
// of what was actually checked. Already found and fixed once this session
// (Settings > QR lead capture's consent checkbox); applying the same safe
// pattern here up front instead of waiting to rediscover it a third time.
const formBoolean = z.preprocess((value) => value === "true" || value === true, z.boolean());

export const createWebsiteLeadSourceSchema = z.object({
  name: z.string().min(1).max(255),
  allowedOrigin: z.string().max(255).optional(),
  defaultCategory: z.string().min(1).max(100),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  utmTags: z.string().max(255).optional(),
  requireConsent: z.boolean().optional(),
});

export const updateWebsiteLeadSourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  allowedOrigin: z.string().max(255).nullable().optional(),
  defaultCategory: z.string().min(1).max(100).optional(),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  utmTags: z.string().max(255).nullable().optional(),
  requireConsent: z.boolean().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export const publicWebsiteLeadSubmitSchema = z.object({
  fullName: z.string().min(1).max(255),
  phone: z.string().min(6).max(20),
  email: z.string().email().optional().or(z.literal("")),
  message: z.string().max(2000).optional(),
  cityOrPincode: z.string().max(255).optional(),
  consentGranted: formBoolean.optional(),
});
