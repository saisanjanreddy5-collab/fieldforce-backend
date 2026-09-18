import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as smartfloService from "../services/smartflo-service";

export const callLead = asyncHandler(async (req: Request, res: Response) => {
  const result = await smartfloService.initiateCallForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, result, "Call started");
});

// Public callback from Smartflo's own servers when a call hangs up - no
// CRM user is logged in here, so a shared secret header stands in for auth.
export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
  if (!smartfloService.isWebhookSecretValid(providedSecret)) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  await smartfloService.handleWebhookEvent(req.body);
  sendSuccess(res, null, "ok");
});
