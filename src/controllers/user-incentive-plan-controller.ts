import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as userIncentivePlanService from "../services/user-incentive-plan-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { userId?: string };
  const assignments = await userIncentivePlanService.listUserIncentivePlans(req.user!.id, req.user!.role, query.userId);
  sendSuccess(res, assignments);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const assignment = await userIncentivePlanService.createUserIncentivePlan(req.body, req.user!.id);
  sendSuccess(res, assignment, "Incentive plan assigned", 201);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await userIncentivePlanService.deleteUserIncentivePlan(String(req.params.id));
  sendSuccess(res, null, "Assignment removed");
});
