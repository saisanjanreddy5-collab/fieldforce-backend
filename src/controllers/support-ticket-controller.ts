import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as supportTicketService from "../services/support-ticket-service";

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
