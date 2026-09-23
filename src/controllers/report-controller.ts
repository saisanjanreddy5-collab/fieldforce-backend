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
