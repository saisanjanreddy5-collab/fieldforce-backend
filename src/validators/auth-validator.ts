import { z } from "zod";
import { ROLES } from "../utils/roles";

// Accepts a plain 10-digit number or one prefixed with +91 - matches the
// Create User form's own placeholder ("+91 98xxx xxxxx"). Blank stays fine
// (mobile is optional); the real bug this closes is that nothing here used
// to check the shape at all, so one badly-formed value could overflow the
// users.mobile VARCHAR(20) column and crash as a raw 500 instead of a clean
// validation error.
const mobileNumber = z
  .union([z.literal(""), z.string().regex(/^(\+91[\s-]?)?\d{10}$/, "Enter a valid 10-digit mobile number")])
  .optional();

export const registerSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    // Optional now that a Level determines the real security tier server
    // side (see auth-service.ts's registerUser) - only a fallback for an
    // account with no Level, so at least one of the two must be present
    // (enforced by the refine below).
    role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT, ROLES.CALL_CENTER]).optional(),
    managerId: z.string().uuid().optional(),
    // A Call Center Executive can be staffed on more than one team at once
    // (see user_sales_teams) - an array, not a single id.
    salesTeamIds: z.array(z.string().uuid()).optional(),
    districtId: z.string().uuid().optional(),
    areaId: z.string().uuid().optional(),
    smartfloAgentNumber: z.string().optional(),
    mobile: mobileNumber,
    territory: z.string().optional(),
    employeeCode: z.string().optional(),
    status: z.enum(["active", "on_leave", "onboarding", "exited"]).optional(),
    levelId: z.string().uuid().optional(),
    // Field employees only - which store type(s) they cover, matched against
    // a lead's own category (COCO/FOFO) when auto-assigning by pincode.
    operationType: z.enum(["COCO", "FOFO", "Both"]).optional(),
    // The pincodes this field employee personally covers - many-to-many on
    // purpose (see employee_pincodes), so more than one person can list the
    // same pincode.
    pincodes: z.array(z.string().trim().min(1)).optional(),
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

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});
