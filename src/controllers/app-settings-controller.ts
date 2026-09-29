import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as appSettingsService from "../services/app-settings-service";

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await appSettingsService.getSetting(String(req.params.key)));
});

export const set = asyncHandler(async (req: Request, res: Response) => {
  const setting = await appSettingsService.setSetting(String(req.params.key), String(req.body.value));
  sendSuccess(res, setting, "Setting updated");
});
