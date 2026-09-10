import { z } from "zod";
import { ROLES } from "../utils/roles";

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT]),
  designation: z.string().optional(),
  managerId: z.string().uuid().optional(),
  salesTeamId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  stateId: z.string().uuid().optional(),
  districtId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});
