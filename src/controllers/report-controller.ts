import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { sendSuccess } from "../utils/response";
import * as reportService from "../services/report-service";

export const salespersonPerformance = asyncHandler(async (req: Request, res: Response) => {
  const { month, zoneId } = req.validatedQuery as { month?: string; zoneId?: string };
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

type PerformanceQuery = { from?: string; to?: string; employeeIds?: string[] };

export const callCenterPerformance = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.getCallCenterPerformance(req.user!.id, req.validatedQuery as PerformanceQuery);
  sendSuccess(res, result);
});

export const fieldSalesPerformance = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.getFieldSalesPerformance(req.user!.id, req.validatedQuery as PerformanceQuery);
  sendSuccess(res, result);
});

export const listSavedViews = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportService.listSavedViews(req.user!.id, (req.validatedQuery as { reportKey: string }).reportKey);
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
