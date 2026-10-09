import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as supportTicketService from "../services/support-ticket-service";
import * as frappeService from "../services/frappe-service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await supportTicketService.createTicketForLead(
    req.body.leadId,
    req.body.subject,
    req.body.description,
    req.user!.id
  );
  sendSuccess(res, ticket, "Support ticket raised", 201);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { leadId?: string; page: number; limit: number };
  const result = await supportTicketService.listSupportTickets(req.user!.id, query);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await supportTicketService.getTicketById(String(req.params.id), req.user!.id);
  sendSuccess(res, ticket);
});

export const listForLead = asyncHandler(async (req: Request, res: Response) => {
  const tickets = await supportTicketService.listTicketsForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, tickets);
});

export const reply = asyncHandler(async (req: Request, res: Response) => {
  const message = await supportTicketService.replyToTicket(String(req.params.id), req.body.message, req.user!.id);
  sendSuccess(res, message, "Reply sent", 201);
});

export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const messages = await supportTicketService.listMessagesForTicket(String(req.params.id), req.user!.id);
  sendSuccess(res, messages);
});

// Public callback from Frappe's own Webhook doctype, configured on HD
// Ticket's on_update event - no CRM user is logged in here, so the HMAC
// signature stands in for auth, same role a shared secret plays for the
// WhatsApp/Smartflo webhooks, just a different (signature-based) scheme.
// Webhook Data on the Frappe side is configured to send exactly
// {ticket_name, status} - see frappe-service.ts's isWebhookSignatureValid.
export const ticketStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["x-frappe-webhook-signature"] as string | undefined;
  if (!frappeService.isWebhookSignatureValid(req.rawBody, signature)) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  const { ticket_name, status } = req.body as { ticket_name?: string; status?: string };
  if (ticket_name && status) {
    await supportTicketService.syncTicketStatusFromWebhook(ticket_name, status);
  }
  sendSuccess(res, null, "ok");
});

// Same pattern, configured on Communication's after_insert event, with a
// Frappe-side condition restricting it to doc.reference_doctype == "HD
// Ticket" and doc.sent_or_received == "Received" - our own outbound replies
// (sent_or_received == "Sent") never reach this endpoint at all, so there's
// no need to filter those back out here.
export const newReplyWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["x-frappe-webhook-signature"] as string | undefined;
  if (!frappeService.isWebhookSignatureValid(req.rawBody, signature)) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  const { ticket_name, content, communication_name } = req.body as {
    ticket_name?: string;
    content?: string;
    communication_name?: string;
  };
  if (ticket_name && content && communication_name) {
    await supportTicketService.recordInboundReplyFromWebhook(ticket_name, content, communication_name);
  }
  sendSuccess(res, null, "ok");
});
