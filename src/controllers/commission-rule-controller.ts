import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as commissionRuleService from "../services/commission-rule-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { incentivePlanId?: string };
  const rules = await commissionRuleService.listCommissionRules(query.incentivePlanId);
  sendSuccess(res, rules);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const rule = await commissionRuleService.getCommissionRuleById(String(req.params.id));
  sendSuccess(res, rule);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const rule = await commissionRuleService.createCommissionRule(req.body, req.user!.id);
  sendSuccess(res, rule, "Commission rule created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const rule = await commissionRuleService.updateCommissionRule(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, rule, "Commission rule updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await commissionRuleService.deleteCommissionRule(String(req.params.id));
  sendSuccess(res, null, "Commission rule deleted");
});
