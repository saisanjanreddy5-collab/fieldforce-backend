import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as assignmentRuleService from "../services/assignment-rule-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  sendSuccess(res, await assignmentRuleService.listAssignmentRules(query));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const rule = await assignmentRuleService.createAssignmentRule(req.body);
  sendSuccess(res, rule, "Assignment rule created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const rule = await assignmentRuleService.updateAssignmentRule(String(req.params.id), req.body, req.user!.id, req.ip);
  sendSuccess(res, rule, "Assignment rule updated");
});
