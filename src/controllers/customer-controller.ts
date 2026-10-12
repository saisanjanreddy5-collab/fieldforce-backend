import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as customerService from "../services/customer-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number; search?: string; status?: string };
  const result = await customerService.listCustomers(req.user!.id, query);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.getCustomerById(String(req.params.id), req.user!.id);
  sendSuccess(res, customer);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomer(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, customer, "Customer updated");
});

export const transactions = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.getCustomerTransactions(String(req.params.id), req.user!.id);
  sendSuccess(res, result);
});

export const timeline = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.getCustomerTimeline(String(req.params.id), req.user!.id);
  sendSuccess(res, result);
});
