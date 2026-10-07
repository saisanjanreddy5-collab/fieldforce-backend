import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as officeService from "../services/office-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await officeService.listOffices(query);
  sendSuccess(res, result);
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
