import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as assignmentRuleService from "../services/assignment-rule-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await assignmentRuleService.listAssignmentRules());
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const rule = await assignmentRuleService.createAssignmentRule(req.body);
  sendSuccess(res, rule, "Assignment rule created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const rule = await assignmentRuleService.updateAssignmentRule(String(req.params.id), req.body);
  sendSuccess(res, rule, "Assignment rule updated");
});
