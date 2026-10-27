import { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ApiError } from "../utils/ApiError";
import { sendError } from "../utils/response";

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendError(res, err.message, err.statusCode, err.errors);
    return;
  }

  if (err instanceof MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large" : err.code === "LIMIT_FILE_COUNT" ? "Too many files" : err.message;
    sendError(res, message, 422);
    return;
  }

  // body-parser's own request-too-large error (e.g. express.json()'s limit)
  // - a plain Error with these two fields bolted on, no exported class to
  // instanceof against. Without this, hitting the JSON size limit (see
  // server.ts's own comment on why bulk import needs a raised one) read as
  // an unexplained "Internal server error" with no hint it was a size
  // problem at all.
  if (err && typeof err === "object" && "type" in err && (err as { type?: unknown }).type === "entity.too.large") {
    sendError(res, "This request is too large - if you're importing a file, try splitting it into smaller batches", 413);
    return;
  }

  console.error(err);
  sendError(res, "Internal server error", 500);
}
