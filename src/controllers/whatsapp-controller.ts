import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as whatsappService from "../services/whatsapp-service";

export const sendForLead = asyncHandler(async (req: Request, res: Response) => {
  const message = await whatsappService.sendTextMessage(String(req.params.id), req.body.body, req.user!.id);
  sendSuccess(res, message, "Message sent", 201);
});

export const listForLead = asyncHandler(async (req: Request, res: Response) => {
  const messages = await whatsappService.listMessagesForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, messages);
});

// Public callback from K3/Pinbot's own servers - no CRM user is logged in
// here, so a shared secret header stands in for auth, same pattern as the
// Smartflo and Microsoft webhook routes.
export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
  if (!whatsappService.isWebhookSecretValid(providedSecret)) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  await whatsappService.handleWebhookEvent(req.body);
  sendSuccess(res, null, "ok");
});
