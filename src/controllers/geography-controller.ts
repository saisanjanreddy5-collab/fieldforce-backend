import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as geographyService from "../services/geography-service";

export const listZones = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await geographyService.listZones(page, limit);
  sendSuccess(res, result);
});

export const listStates = asyncHandler(async (req: Request, res: Response) => {
  const { zoneId, page, limit } = req.validatedQuery as unknown as { zoneId?: string; page: number; limit: number };
  const result = await geographyService.listStates(zoneId, page, limit);
  sendSuccess(res, result);
});
