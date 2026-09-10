import { Response } from "express";

interface SuccessBody<T> {
  success: true;
  data: T;
  message?: string;
}

interface ErrorBody {
  success: false;
  message: string;
  errors?: unknown;
}

export function sendSuccess<T>(res: Response, data: T, message?: string, statusCode = 200): Response {
  const body: SuccessBody<T> = { success: true, data, message };
  return res.status(statusCode).json(body);
}

export function sendError(res: Response, message: string, statusCode = 400, errors?: unknown): Response {
  const body: ErrorBody = { success: false, message, errors };
  return res.status(statusCode).json(body);
}
