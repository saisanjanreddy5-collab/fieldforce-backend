import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as overrideService from "../services/user-permission-override-service";

export const listForUser = asyncHandler(async (req: Request, res: Response) => {
  const overrides = await overrideService.listOverridesForUser(String(req.params.userId));
  sendSuccess(res, overrides);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { userId, permission, grantType, reason, expiresAt } = req.body;
  const override = await overrideService.createOverride(userId, permission, grantType, reason, expiresAt, req.user!.id);
  sendSuccess(res, override, "Override created", 201);
});

export const clear = asyncHandler(async (req: Request, res: Response) => {
  await overrideService.clearOverride(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Override cleared");
});

export const clearAllForUser = asyncHandler(async (req: Request, res: Response) => {
  const count = await overrideService.clearAllOverridesForUser(String(req.params.userId), req.user!.id);
  sendSuccess(res, { cleared: count }, "Overrides cleared");
});
