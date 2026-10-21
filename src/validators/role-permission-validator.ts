import { z } from "zod";
import { ROLES } from "../utils/roles";

export const setRolePermissionSchema = z.object({
  role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT, ROLES.CALL_CENTER]),
  permission: z.string().min(1),
  granted: z.boolean(),
});

export const resetRoleToDefaultSchema = z.object({
  role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT, ROLES.CALL_CENTER]),
});

// Admin itself is deliberately excluded here (unlike the schema above) -
// "give this role Admin access" never makes sense as a target.
export const grantAdminAccessSchema = z.object({
  role: z.enum([ROLES.MANAGER, ROLES.AGENT, ROLES.CALL_CENTER]),
});
