import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as customerAddressService from "../services/customer-address-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await customerAddressService.listAddresses(String(req.params.customerId), req.user!.id);
  sendSuccess(res, addresses);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const address = await customerAddressService.createAddress(String(req.params.customerId), req.body, req.user!.id);
  sendSuccess(res, address, "Address added", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const address = await customerAddressService.updateAddress(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, address, "Address updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await customerAddressService.deleteAddress(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Address removed");
});
