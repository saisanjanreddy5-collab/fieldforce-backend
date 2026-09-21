import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as managerChangeLogService from "../services/manager-change-log-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const entries = await managerChangeLogService.listManagerChanges(userId);
  sendSuccess(res, entries);
});
