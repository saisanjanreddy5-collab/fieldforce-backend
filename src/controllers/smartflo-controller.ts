import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as smartfloService from "../services/smartflo-service";

export const callLead = asyncHandler(async (req: Request, res: Response) => {
  const result = await smartfloService.initiateCallForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, result, "Call started");
});
