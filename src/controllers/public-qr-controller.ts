import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as qrCampaignService from "../services/qr-campaign-service";

export const getInfo = asyncHandler(async (req: Request, res: Response) => {
  const info = await qrCampaignService.getPublicCampaignInfo(String(req.params.code), req.ip ?? "");
  sendSuccess(res, info);
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const result = await qrCampaignService.submitPublicCapture(
    String(req.params.code),
    req.body,
    req.file ? { file: req.file } : undefined,
    req.ip
  );
  sendSuccess(res, result, "Submitted", 201);
});
