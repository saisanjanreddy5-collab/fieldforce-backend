import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as customerContactService from "../services/customer-contact-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const contacts = await customerContactService.listContacts(String(req.params.customerId), req.user!.id);
  sendSuccess(res, contacts);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const contact = await customerContactService.createContact(String(req.params.customerId), req.body, req.user!.id);
  sendSuccess(res, contact, "Contact added", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const contact = await customerContactService.updateContact(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, contact, "Contact updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await customerContactService.deleteContact(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Contact removed");
});
