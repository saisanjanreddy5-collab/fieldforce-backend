import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as dashboardService from "../services/dashboard-service";

export const overview = asyncHandler(async (req: Request, res: Response) => {
  const result = await dashboardService.getOverview(req.user!.id);
  sendSuccess(res, result);
});

export const pipelineByStage = asyncHandler(async (req: Request, res: Response) => {
  const result = await dashboardService.getPipelineByStage(req.user!.id);
  sendSuccess(res, result);
});

export const leadsByStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await dashboardService.getLeadsByStatus(req.user!.id);
  sendSuccess(res, result);
});

export const teamPerformance = asyncHandler(async (req: Request, res: Response) => {
  const result = await dashboardService.getTeamPerformance(req.user!.id);
  sendSuccess(res, result);
});

export const visitHistory = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    from?: string;
    to?: string;
    page: number;
    limit: number;
  };
  const result = await dashboardService.getVisitHistory(req.user!.id, query);
  sendSuccess(res, result);
});
