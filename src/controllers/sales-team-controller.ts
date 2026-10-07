import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as salesTeamService from "../services/sales-team-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await salesTeamService.listSalesTeams(query);
  sendSuccess(res, result);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const salesTeam = await salesTeamService.createSalesTeam(req.body);
  sendSuccess(res, salesTeam, "Sales team created", 201);
});
