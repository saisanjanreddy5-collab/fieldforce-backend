import { z } from "zod";

// Deliberately narrow - self-service profile editing must never let a
// user touch their own role, permissions, manager, level, or territory.
// Only the one field a person legitimately needs to self-correct (their
// own Smartflo calling number, e.g. after switching phones) is exposed
// here, unlike the full admin-only updateUserSchema below.
export const updateOwnProfileSchema = z.object({
  smartfloAgentNumber: z.string().min(1, "Enter a phone number").optional(),
});

export const updateUserSchema = z.object({
  designation: z.string().optional(),
  managerId: z.string().uuid().or(z.literal("")).optional(),
  dottedLineManagerId: z.string().uuid().or(z.literal("")).optional(),
  smartfloAgentNumber: z.string().optional(),
  mobile: z.string().optional(),
  territory: z.string().optional(),
  salesTeamId: z.string().uuid().or(z.literal("")).optional(),
  zoneId: z.string().uuid().or(z.literal("")).optional(),
  stateId: z.string().uuid().or(z.literal("")).optional(),
  employeeCode: z.string().optional(),
  dateOfJoining: z.string().or(z.literal("")).optional(),
  status: z.enum(["active", "on_leave", "onboarding", "exited"]).optional(),
  levelId: z.string().uuid().or(z.literal("")).optional(),
  officeId: z.string().uuid().or(z.literal("")).optional(),
  divisionChannelId: z.string().uuid().or(z.literal("")).optional(),
  customerCategoryId: z.string().uuid().or(z.literal("")).optional(),
});
