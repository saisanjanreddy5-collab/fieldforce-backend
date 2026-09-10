import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as opportunityService from "../services/opportunity-service";

export const convert = asyncHandler(async (req: Request, res: Response) => {
  const opportunity = await opportunityService.convertLeadToOpportunity(
    String(req.params.id),
    req.body,
    req.user!.id
  );
  sendSuccess(res, opportunity, "Opportunity created", 201);
});

export const listForLead = asyncHandler(async (req: Request, res: Response) => {
  const opportunities = await opportunityService.listOpportunitiesForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, opportunities);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    stage?: string;
    leadId?: string;
    search?: string;
    page: number;
    limit: number;
  };
  const opportunities = await opportunityService.listOpportunitiesForUser(req.user!.id, query);
  sendSuccess(res, opportunities);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const opportunity = await opportunityService.getOpportunityById(String(req.params.id), req.user!.id);
  sendSuccess(res, opportunity);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const opportunity = await opportunityService.updateOpportunity(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, opportunity, "Opportunity updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await opportunityService.deleteOpportunity(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Opportunity deleted");
});
