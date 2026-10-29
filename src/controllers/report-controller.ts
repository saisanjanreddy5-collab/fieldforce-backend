import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as reportService from "../services/report-service";

export const salespersonPerformance = asyncHandler(async (req: Request, res: Response) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : undefined;
  const result = await reportService.getSalespersonPerformance(req.user!.id, { month, zoneId });
  sendSuccess(res, result);
});

export const stateWise = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.getStateWiseReport(req.user!.id);
  sendSuccess(res, result);
});

export const b2bGroup = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.getB2BGroupPerformance(req.user!.id);
  sendSuccess(res, result);
});

export const leadSourceRoi = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.getLeadSourceROI(req.user!.id);
  sendSuccess(res, result);
});

export const fofoCohortRetention = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.getFofoCohortRetention(req.user!.id);
  sendSuccess(res, result);
});

// employeeIds arrives as a comma-separated query string (no array-query
// precedent exists elsewhere in this codebase's GET routes - every other
// filter here is a single scalar) - split/filtered the same way
// CORS_ALLOWED_ORIGINS is split in config/env.ts.
function parseEmployeeIds(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const ids = value.split(",").filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export const callCenterPerformance = asyncHandler(async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const employeeIds = parseEmployeeIds(req.query.employeeIds);
  const result = await reportService.getCallCenterPerformance(req.user!.id, { from, to, employeeIds });
  sendSuccess(res, result);
});

export const fieldSalesPerformance = asyncHandler(async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const employeeIds = parseEmployeeIds(req.query.employeeIds);
  const result = await reportService.getFieldSalesPerformance(req.user!.id, { from, to, employeeIds });
  sendSuccess(res, result);
});

export const listSavedViews = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.listSavedViews(req.user!.id, String(req.query.reportKey));
  sendSuccess(res, result);
});

export const createSavedView = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.createSavedView(req.user!.id, req.body);
  sendSuccess(res, result, "View saved", 201);
});

export const deleteSavedView = asyncHandler(async (req: Request, res: Response) => {
  await reportService.deleteSavedView(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "View removed");
});
