import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as geographyService from "../services/geography-service";

export const listZones = asyncHandler(async (_req: Request, res: Response) => {
  const zones = await geographyService.listZones();
  sendSuccess(res, zones);
});

export const listStates = asyncHandler(async (req: Request, res: Response) => {
  const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : undefined;
  const states = await geographyService.listStates(zoneId);
  sendSuccess(res, states);
});
