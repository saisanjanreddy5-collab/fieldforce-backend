import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as websiteLeadService from "../services/website-lead-service";
import * as geographyService from "../services/geography-service";

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const result = await websiteLeadService.submitWebsiteLead(String(req.params.apiKey), req.body, req.ip);
  sendSuccess(res, result, "Submitted", 201);
});

// Public reference data for whoever builds the actual HTML form on the
// client's own website - no api key needed, just a plain list of valid
// states to populate a dropdown with, so the stateId they submit is one
// assignment_rules can actually match against.
export const listStates = asyncHandler(async (_req: Request, res: Response) => {
  // Kept as a plain array for this public, unauthenticated contract - the
  // external site builder has no concept of pagination, and there are only
  // ever a few dozen states, so one generously-sized page covers all of them.
  const { states } = await geographyService.listStates(undefined, 1, 200);
  sendSuccess(res, states);
});
