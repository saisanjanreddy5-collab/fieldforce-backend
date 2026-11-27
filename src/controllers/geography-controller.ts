import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
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

export const listCities = asyncHandler(async (req: Request, res: Response) => {
  const { stateId, search } = req.validatedQuery as unknown as { stateId: string; search?: string };
  const cities = await geographyService.listCities(stateId, search);
  sendSuccess(res, { cities });
});

export const listAreas = asyncHandler(async (req: Request, res: Response) => {
  const filters = req.validatedQuery as unknown as { cityId?: string; pincode?: string; search?: string };
  const areas = await geographyService.listAreas(filters);
  sendSuccess(res, { areas });
});
