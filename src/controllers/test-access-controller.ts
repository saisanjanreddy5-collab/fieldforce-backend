import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as testAccessService from "../services/test-access-service";

export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  const summary = await testAccessService.getAccessSummary(String(req.params.id), req.user!.id, req.user!.role);
  sendSuccess(res, summary);
});
