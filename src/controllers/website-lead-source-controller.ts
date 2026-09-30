import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as websiteLeadService from "../services/website-lead-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await websiteLeadService.listWebsiteLeadSources());
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const source = await websiteLeadService.createWebsiteLeadSource(req.body, req.user!.id);
  sendSuccess(res, source, "Website lead source created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const source = await websiteLeadService.updateWebsiteLeadSource(String(req.params.id), req.body);
  sendSuccess(res, source, "Website lead source updated");
});
