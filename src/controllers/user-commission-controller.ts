import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as userCommissionService from "../services/user-commission-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { userId?: string; page: number; limit: number };
  const result = await userCommissionService.listUserCommissions(req.user!.id, req.user!.role, query);
  sendSuccess(res, result);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const commission = await userCommissionService.createUserCommission(req.body, req.user!.id);
  sendSuccess(res, commission, "Commission arrangement added", 201);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await userCommissionService.deleteUserCommission(String(req.params.id));
  sendSuccess(res, null, "Commission arrangement removed");
});
