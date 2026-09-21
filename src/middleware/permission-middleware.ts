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
