import { NextFunction, Request, Response } from "express";
import { getPermissionsForRole } from "../services/permission-service";
import { ApiError } from "../utils/ApiError";
// import type (not a value import) so it's fully erased from the emitted JS,
// while still pulling the Express.Request.user augmentation into the type
// program - matching how auth-middleware.ts reuses the same AuthenticatedUser
// type - so this file type-checks correctly even in isolation, e.g. a
// standalone ts-node script that imports this middleware directly.
import type { AuthenticatedUser } from "../types/express";

// Additional authorization mechanism, built on the Phase 3A role_permissions
// foundation. This does not replace requireRole and nothing wires it into
// any route yet - it is only exported for use starting in a later phase.
export function requirePermission(permission: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) {
      next(new ApiError(401, "Authentication required"));
      return;
    }

    try {
      const permissions = await getPermissionsForRole(user.role);
      if (!permissions.includes(permission)) {
        next(new ApiError(403, "You do not have permission to perform this action"));
        return;
      }
      next();
    } catch (err) {
      console.error("requirePermission: failed to resolve permissions", err);
      next(new ApiError(403, "You do not have permission to perform this action"));
    }
  };
}

// For a route that two genuinely different roles reach for two genuinely
// different reasons - e.g. GET /leads is both "the full Leads module"
// (leads.view) and "my own Call Center queue" (leads.queue_view), and
// granting one shouldn't require granting the other. Passes as soon as any
// one of the listed permissions is held; same shape as requireRole's own
// variadic allowedRoles.
export function requireAnyPermission(...permissions: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) {
      next(new ApiError(401, "Authentication required"));
      return;
    }

    try {
      const granted = await getPermissionsForRole(user.role);
      if (!permissions.some((p) => granted.includes(p))) {
        next(new ApiError(403, "You do not have permission to perform this action"));
        return;
      }
      next();
    } catch (err) {
      console.error("requireAnyPermission: failed to resolve permissions", err);
      next(new ApiError(403, "You do not have permission to perform this action"));
    }
  };
}
