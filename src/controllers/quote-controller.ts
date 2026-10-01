import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as quoteService from "../services/quote-service";
import * as quotePdfService from "../services/quote-pdf-service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const result = await quoteService.createQuote(req.body, req.user!.id);
  sendSuccess(res, result, "Quote created", 201);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    leadId?: string;
    opportunityId?: string;
    status?: string;
    search?: string;
    page: number;
    limit: number;
  };
  const result = await quoteService.listQuotes(req.user!.id, query);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await quoteService.getQuoteById(String(req.params.id), req.user!.id);
  sendSuccess(res, result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const result = await quoteService.updateQuote(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, result, "Quote updated - new version saved");
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const quote = await quoteService.updateQuoteStatus(String(req.params.id), req.body.status, req.user!.id);
  sendSuccess(res, quote, "Quote status updated");
});

export const listForLead = asyncHandler(async (req: Request, res: Response) => {
  const quotes = await quoteService.listQuotesForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, quotes);
});

export const listForOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const quotes = await quoteService.listQuotesForOpportunity(String(req.params.id), req.user!.id);
  sendSuccess(res, quotes);
});

export const downloadPdf = asyncHandler(async (req: Request, res: Response) => {
  const { stream, filename } = await quotePdfService.buildQuotePdf(String(req.params.id), req.user!.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  stream.pipe(res);
  stream.end();
});
