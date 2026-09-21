import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as levelService from "../services/level-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const levels = await levelService.listLevels();
  sendSuccess(res, levels);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const level = await levelService.createLevel(req.body);
  sendSuccess(res, level, "Level created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const level = await levelService.updateLevel(String(req.params.id), req.body);
  sendSuccess(res, level, "Level updated");
});
