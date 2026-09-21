import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as targetService from "../services/target-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { userId?: string };
  const targets = await targetService.listTargets(req.user!.id, req.user!.role, query.userId);
  sendSuccess(res, targets);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const target = await targetService.getTargetById(String(req.params.id), req.user!.id, req.user!.role);
  sendSuccess(res, target);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const target = await targetService.createTarget(req.body, req.user!.id);
  sendSuccess(res, target, "Target created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const target = await targetService.updateTarget(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, target, "Target updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await targetService.deleteTarget(String(req.params.id));
  sendSuccess(res, null, "Target deleted");
});
