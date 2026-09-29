import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as qrCampaignService from "../services/qr-campaign-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await qrCampaignService.listCampaigns());
});

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await qrCampaignService.getSummaryStats());
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await qrCampaignService.createCampaign(req.body, req.user!.id);
  sendSuccess(res, campaign, "QR campaign created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await qrCampaignService.updateCampaign(String(req.params.id), req.body);
  sendSuccess(res, campaign, "QR campaign updated");
});
