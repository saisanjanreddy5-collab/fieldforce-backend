import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as salesOrderService from "../services/sales-order-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const orders = await salesOrderService.listOrdersForCustomer(String(req.params.customerId), req.user!.id);
  sendSuccess(res, orders);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const order = await salesOrderService.createOrder(String(req.params.customerId), req.body, req.user!.id);
  sendSuccess(res, order, "Sales order created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const order = await salesOrderService.updateOrder(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, order, "Sales order updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await salesOrderService.deleteOrder(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Sales order deleted");
});
