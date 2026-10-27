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

// The standard Meta/WABA webhook verification handshake - before a WABA
// number's webhook subscription is considered active, the platform sends a
// one-time GET with hub.mode=subscribe and a hub.challenge value, which the
// receiving server must echo back verbatim to prove it controls this URL.
// Until this route existed, pointing a new number's webhook at this URL had
// no GET handler to answer that handshake (only POST was wired up) - the
// subscription attempt would silently fail here with no error surfaced to
// whoever configured it, and no POST webhook would ever follow, which is
// indistinguishable from "webhook not configured at all" from our side.
// Reuses the same shared secret as the POST route's own auth, as the verify
// token - there is no separate token configured anywhere for this.
export const verifyWebhook = (req: Request, res: Response): void => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && whatsappService.isWebhookSecretValid(token as string | undefined)) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
};

// Public callback from K3/Pinbot's own servers - no CRM user is logged in
// here, so a shared secret header stands in for auth, same pattern as the
// Smartflo and Microsoft webhook routes.
export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
  if (!whatsappService.isWebhookSecretValid(providedSecret)) {
    // TEMPORARY diagnostic log - K3's real automated webhook delivery is
    // getting rejected here (confirmed via nginx access log: axios/1.15.2
    // user-agent, not Postman/curl), but we don't yet know what auth it
    // actually sends since their manual Postman test used a header that may
    // not be what their dashboard-configured delivery actually attaches.
    // Remove once that's confirmed.
    console.warn("WhatsApp webhook rejected - headers received:", JSON.stringify(req.headers));
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  await whatsappService.handleWebhookEvent(req.body);
  sendSuccess(res, null, "ok");
});
