import { z } from "zod";
import { ROLES } from "../utils/roles";

export const registerSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    // Optional now that a Level determines the real security tier server
    // side (see auth-service.ts's registerUser) - only a fallback for an
    // account with no Level, so at least one of the two must be present
    // (enforced by the refine below).
    role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT]).optional(),
    designation: z.string().optional(),
    managerId: z.string().uuid().optional(),
    dottedLineManagerId: z.string().uuid().optional(),
    salesTeamId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
    stateId: z.string().uuid().optional(),
    districtId: z.string().uuid().optional(),
    areaId: z.string().uuid().optional(),
    smartfloAgentNumber: z.string().optional(),
    mobile: z.string().optional(),
    territory: z.string().optional(),
    employeeCode: z.string().optional(),
    dateOfJoining: z.string().optional(),
    status: z.enum(["active", "on_leave", "onboarding", "exited"]).optional(),
    levelId: z.string().uuid().optional(),
    officeId: z.string().uuid().optional(),
    divisionChannelId: z.string().uuid().optional(),
    customerCategoryId: z.string().uuid().optional(),
  })
  .refine((data) => Boolean(data.role) || Boolean(data.levelId), {
    message: "Either a role or a level is required",
    path: ["levelId"],
  });

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});
