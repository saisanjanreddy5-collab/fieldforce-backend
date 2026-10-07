import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as managerChangeLogService from "../services/manager-change-log-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { userId, page, limit } = req.validatedQuery as unknown as { userId?: string; page: number; limit: number };
  const entries = await managerChangeLogService.listManagerChanges(userId, page, limit);
  sendSuccess(res, entries);
});
