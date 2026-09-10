import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { AuthenticatedUser } from "../types/express";
import { Role, ROLES } from "../utils/roles";

interface AccessTokenPayload {
  id: string;
  role: Role;
  managerId: string | null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing or invalid Authorization header");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
    const user: AuthenticatedUser = {
      id: payload.id,
      role: payload.role,
      managerId: payload.managerId,
    };
    req.user = user;
    next();
  } catch {
    throw new ApiError(401, "Invalid or expired token");
  }
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ApiError(403, "You do not have permission to perform this action");
    }

    next();
  };
}

export const ADMIN_ONLY = [ROLES.ADMIN];
export const MANAGER_AND_ABOVE = [ROLES.ADMIN, ROLES.MANAGER];
