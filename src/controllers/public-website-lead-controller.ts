import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as websiteLeadService from "../services/website-lead-service";

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const result = await websiteLeadService.submitWebsiteLead(String(req.params.apiKey), req.body, req.ip);
  sendSuccess(res, result, "Submitted", 201);
});
