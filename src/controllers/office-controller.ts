import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as officeService from "../services/office-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const offices = await officeService.listOffices();
  sendSuccess(res, offices);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const office = await officeService.getOfficeById(String(req.params.id));
  sendSuccess(res, office);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const office = await officeService.createOffice(req.body, req.user!.id);
  sendSuccess(res, office, "Office created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const office = await officeService.updateOffice(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, office, "Office updated");
});
