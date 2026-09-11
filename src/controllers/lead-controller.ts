import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as leadService from "../services/lead-service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.createLead(req.body, req.user!.id);
  sendSuccess(res, lead, "Lead created", 201);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    status?: string;
    ownerId?: string;
    zoneId?: string;
    stateId?: string;
    districtId?: string;
    areaId?: string;
    search?: string;
    page: number;
    limit: number;
  };
  const leads = await leadService.listLeadsForUser(req.user!.id, query);
  sendSuccess(res, leads);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.getLeadById(String(req.params.id), req.user!.id);
  sendSuccess(res, lead);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.updateLead(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, lead, "Lead updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await leadService.deleteLead(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Lead deleted");
});

export const share = asyncHandler(async (req: Request, res: Response) => {
  await leadService.shareLead(String(req.params.id), req.body.userId, req.user!.id);
  sendSuccess(res, null, "Lead shared", 201);
});

export const unshare = asyncHandler(async (req: Request, res: Response) => {
  await leadService.unshareLead(String(req.params.id), String(req.params.userId), req.user!.id);
  sendSuccess(res, null, "Share removed");
});

export const listShares = asyncHandler(async (req: Request, res: Response) => {
  const shares = await leadService.listLeadShares(String(req.params.id), req.user!.id);
  sendSuccess(res, shares);
});

export const getConsent = asyncHandler(async (req: Request, res: Response) => {
  const consent = await leadService.getLeadConsent(String(req.params.id), req.user!.id);
  sendSuccess(res, consent);
});
