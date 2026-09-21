import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as classificationService from "../services/classification-service";

export const listDivisionChannels = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await classificationService.listDivisionChannels();
  sendSuccess(res, rows);
});

export const listCustomerCategories = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await classificationService.listCustomerCategories();
  sendSuccess(res, rows);
});
