import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as incentivePlanService from "../services/incentive-plan-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await incentivePlanService.listIncentivePlans();
  sendSuccess(res, plans);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const plan = await incentivePlanService.getIncentivePlanById(String(req.params.id));
  sendSuccess(res, plan);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const plan = await incentivePlanService.createIncentivePlan(req.body, req.user!.id);
  sendSuccess(res, plan, "Incentive plan created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const plan = await incentivePlanService.updateIncentivePlan(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, plan, "Incentive plan updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await incentivePlanService.deleteIncentivePlan(String(req.params.id));
  sendSuccess(res, null, "Incentive plan deleted");
});
