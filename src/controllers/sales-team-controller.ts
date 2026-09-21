import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as salesTeamService from "../services/sales-team-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const salesTeams = await salesTeamService.listSalesTeams();
  sendSuccess(res, salesTeams);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const salesTeam = await salesTeamService.createSalesTeam(req.body);
  sendSuccess(res, salesTeam, "Sales team created", 201);
});
