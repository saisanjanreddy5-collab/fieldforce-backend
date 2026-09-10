import { Role } from "../utils/roles";

export interface AuthenticatedUser {
  id: string;
  role: Role;
  managerId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      // Express 5's req.query is a read-only, re-parsed-on-every-access getter,
      // so validated/coerced query data is stored here instead of reassigning it.
      validatedQuery?: Record<string, unknown>;
    }
  }
}

export {};
