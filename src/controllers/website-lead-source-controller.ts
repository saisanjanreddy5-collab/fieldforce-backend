import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as websiteLeadService from "../services/website-lead-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  sendSuccess(res, await websiteLeadService.listWebsiteLeadSources(query));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const source = await websiteLeadService.createWebsiteLeadSource(req.body, req.user!.id);
  sendSuccess(res, source, "Website lead source created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const source = await websiteLeadService.updateWebsiteLeadSource(String(req.params.id), req.body);
  sendSuccess(res, source, "Website lead source updated");
});
