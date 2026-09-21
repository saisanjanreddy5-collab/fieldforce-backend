import { z } from "zod";

export const updateUserSchema = z.object({
  designation: z.string().optional(),
  managerId: z.string().uuid().or(z.literal("")).optional(),
  smartfloAgentNumber: z.string().optional(),
  territory: z.string().optional(),
  salesTeamId: z.string().uuid().or(z.literal("")).optional(),
  zoneId: z.string().uuid().or(z.literal("")).optional(),
  employeeCode: z.string().optional(),
  dateOfJoining: z.string().or(z.literal("")).optional(),
  status: z.enum(["active", "on_leave", "onboarding"]).optional(),
  levelId: z.string().uuid().or(z.literal("")).optional(),
  officeId: z.string().uuid().or(z.literal("")).optional(),
});
