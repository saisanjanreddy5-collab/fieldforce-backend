import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as callCenterService from "../services/call-center-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number; assignedTo?: string };
  const result = await callCenterService.listCalls(req.user!.id, query);
  sendSuccess(res, result);
});

export const upcoming = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { limit: number };
  const result = await callCenterService.listUpcomingCalls(req.user!.id, query);
  sendSuccess(res, result);
});

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const result = await callCenterService.getCallCenterStats(req.user!.id);
  sendSuccess(res, result);
});
