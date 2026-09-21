import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as approvalBandService from "../services/approval-band-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const bands = await approvalBandService.listApprovalBands();
  sendSuccess(res, bands);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const band = await approvalBandService.createApprovalBand(req.body);
  sendSuccess(res, band, "Approval band created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const band = await approvalBandService.updateApprovalBand(String(req.params.id), req.body);
  sendSuccess(res, band, "Approval band updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await approvalBandService.deleteApprovalBand(String(req.params.id));
  sendSuccess(res, null, "Approval band deleted");
});
