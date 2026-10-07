import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as scheduledTransferService from "../services/scheduled-transfer-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await scheduledTransferService.listScheduledTransfers(req.user!.id, req.user!.role, query);
  sendSuccess(res, result);
});

export const createTerritoryTransfer = asyncHandler(async (req: Request, res: Response) => {
  const transfer = await scheduledTransferService.createTerritoryTransfer(req.body, req.user!.id, req.user!.role);
  sendSuccess(res, transfer, "Territory transfer scheduled", 201);
});

export const createScheduledReassign = asyncHandler(async (req: Request, res: Response) => {
  const transfer = await scheduledTransferService.createScheduledReassign(req.body, req.user!.id, req.user!.role);
  sendSuccess(res, transfer, "Bulk re-assign scheduled", 201);
});

export const createExit = asyncHandler(async (req: Request, res: Response) => {
  const transfer = await scheduledTransferService.createExit(req.body, req.user!.id, req.user!.role);
  sendSuccess(res, transfer, "Exit recorded", 201);
});
