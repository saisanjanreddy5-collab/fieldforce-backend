import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as teamDashboardService from "../services/team-dashboard-service";

export const getAvailability = asyncHandler(async (req: Request, res: Response) => {
  const result = await teamDashboardService.getTeamAvailability(req.user!.id, req.user!.role);
  sendSuccess(res, result);
});
