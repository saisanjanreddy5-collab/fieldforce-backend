import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as invoiceService from "../services/invoice-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const invoices = await invoiceService.listInvoicesForCustomer(String(req.params.customerId), req.user!.id);
  sendSuccess(res, invoices);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await invoiceService.createInvoice(String(req.params.customerId), req.body, req.user!.id);
  sendSuccess(res, invoice, "Invoice created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await invoiceService.updateInvoice(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, invoice, "Invoice updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await invoiceService.deleteInvoice(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Invoice deleted");
});
