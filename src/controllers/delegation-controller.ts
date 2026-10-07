import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as delegationService from "../services/delegation-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await delegationService.listDelegations(query);
  sendSuccess(res, result);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const delegation = await delegationService.createDelegation(req.body, req.user!.id);
  sendSuccess(res, delegation, "Delegation added", 201);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await delegationService.deleteDelegation(String(req.params.id));
  sendSuccess(res, null, "Delegation removed");
});
