import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

// Deliberately narrow - self-service profile editing must never let a
// user touch their own role, permissions, manager, level, or territory.
// Only the one field a person legitimately needs to self-correct (their
// own Smartflo calling number, e.g. after switching phones) is exposed
// here, unlike the full admin-only updateUserSchema below.
export const updateOwnProfileSchema = z.object({
  smartfloAgentNumber: z.string().min(1, "Enter a phone number").optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  managerId: z.string().uuid().or(z.literal("")).optional(),
  smartfloAgentNumber: z.string().optional(),
  mobile: z.string().optional(),
  territory: z.string().optional(),
  // A Call Center Executive can be staffed on more than one team at once
  // (see user_sales_teams) - an array, not a single id. [] clears every
  // team this person is staffed on, same convention as pincodes below.
  salesTeamIds: z.array(z.string().uuid()).optional(),
  employeeCode: z.string().optional(),
  status: z.enum(["active", "on_leave", "onboarding", "exited"]).optional(),
  levelId: z.string().uuid().or(z.literal("")).optional(),
  // Login access toggle - Administrator only (same users.update gate as
  // every other field here). true/false, not a tri-state - there's no
  // separate "deleted" state in the app itself, only this.
  isActive: z.boolean().optional(),
  // Same pair as registerSchema - field employees only. pincodes is a full
  // replace, not a diff: submitting [] clears every pincode this person
  // covers.
  operationType: z.enum(["COCO", "FOFO", "Both"]).or(z.literal("")).optional(),
  pincodes: z.array(z.string().trim().min(1)).optional(),
});

export const listUsersQuerySchema = paginationQuerySchema;

// Admin-initiated - no currentPassword proof needed here (unlike
// changePasswordSchema in auth-validator.ts): the admin is proving their
// own identity via their own session/permission, not standing in for the
// target user.
export const adminResetPasswordSchema = z.object({
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});
