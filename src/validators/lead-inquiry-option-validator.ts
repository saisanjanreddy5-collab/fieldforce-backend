import { z } from "zod";

export const INQUIRY_OPTION_FIELD_TYPES = ["category", "source"] as const;

export const listLeadInquiryOptionsQuerySchema = z.object({
  fieldType: z.enum(INQUIRY_OPTION_FIELD_TYPES).optional(),
});

export const createLeadInquiryOptionSchema = z.object({
  fieldType: z.enum(INQUIRY_OPTION_FIELD_TYPES),
  label: z.string().trim().min(1, "Label is required").max(150),
});

export const updateLeadInquiryOptionSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(150).optional(),
  isActive: z.boolean().optional(),
});
