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
      // The exact raw bytes of the request body, stashed by express.json()'s
      // verify callback in server.ts before JSON.parse runs - needed to
      // verify Frappe's HMAC webhook signature, which is computed over the
      // original byte stream, not a re-serialization of the parsed object
      // (which could legitimately differ in key order/whitespace and make a
      // genuine request fail verification).
      rawBody?: Buffer;
    }
  }
}

export {};
