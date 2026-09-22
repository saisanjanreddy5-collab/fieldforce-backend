import { z } from "zod";
import { ROLES } from "../utils/roles";

export const setRolePermissionSchema = z.object({
  role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT]),
  permission: z.string().min(1),
  granted: z.boolean(),
});

export const resetRoleToDefaultSchema = z.object({
  role: z.enum([ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT]),
});
