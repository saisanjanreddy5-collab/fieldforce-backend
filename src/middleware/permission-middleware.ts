import { NextFunction, Request, Response } from "express";
import { getEffectivePermissions } from "../services/permission-service";
import { ApiError } from "../utils/api-error";
// import type (not a value import) so it's fully erased from the emitted JS,
// while still pulling the Express.Request.user augmentation into the type
// program - matching how auth-middleware.ts reuses the same AuthenticatedUser
// type - so this file type-checks correctly even in isolation, e.g. a
// standalone ts-node script that imports this middleware directly.
import type { AuthenticatedUser } from "../types/express";

// The route gate: passes as soon as the caller holds any one of the listed
// permissions - their role's, adjusted by their own overrides (cached in
// permission-service.ts). A deactivated account is turned away here at once,
// not only when its 15-minute access token runs out.
// Several permissions are for a route two roles reach for different reasons -
// e.g. GET /leads is both "the full Leads module" (leads.view) and "my own
// Call Center queue" (leads.queue_view).
export function requireAnyPermission(...permissions: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) {
      next(new ApiError(401, "Authentication required"));
      return;
    }

    try {
      const { isActive, permissions: granted } = await getEffectivePermissions(user.id);
      if (!isActive) {
        next(new ApiError(401, "This account has been deactivated"));
        return;
      }
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

export function requirePermission(permission: string) {
  return requireAnyPermission(permission);
}
