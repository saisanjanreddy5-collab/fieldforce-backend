import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as geographyService from "../services/geography-service";

export const listZones = asyncHandler(async (_req: Request, res: Response) => {
  const zones = await geographyService.listZones();
  sendSuccess(res, zones);
});
