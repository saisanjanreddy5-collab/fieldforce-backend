import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as paymentService from "../services/payment-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const payments = await paymentService.listPaymentsForCustomer(String(req.params.customerId), req.user!.id);
  sendSuccess(res, payments);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const payment = await paymentService.createPayment(String(req.params.customerId), req.body, req.user!.id);
  sendSuccess(res, payment, "Payment recorded", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const payment = await paymentService.updatePayment(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, payment, "Payment updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await paymentService.deletePayment(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Payment deleted");
});
