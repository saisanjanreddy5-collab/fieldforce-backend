import { NextFunction, Request, Response } from "express";
import { ZodError, ZodSchema } from "zod";
import { sendError } from "../utils/response";

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, "Validation failed", 422, err.flatten().fieldErrors);
        return;
      }
      next(err);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Stored on req.validatedQuery, not req.query - Express 5's req.query
      // is a read-only getter that re-parses the URL on every access, so a
      // reassignment (or a mutation of one snapshot of it) doesn't stick.
      req.validatedQuery = schema.parse(req.query) as Record<string, unknown>;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, "Validation failed", 422, err.flatten().fieldErrors);
        return;
      }
      next(err);
    }
  };
}
