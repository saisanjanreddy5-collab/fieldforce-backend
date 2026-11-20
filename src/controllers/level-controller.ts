import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { sendSuccess } from "../utils/response";
import * as levelService from "../services/level-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await levelService.listLevels(query);
  sendSuccess(res, result);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const level = await levelService.createLevel(req.body);
  sendSuccess(res, level, "Level created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const level = await levelService.updateLevel(String(req.params.id), req.body);
  sendSuccess(res, level, "Level updated");
});

export const archive = asyncHandler(async (req: Request, res: Response) => {
  const level = await levelService.archiveLevel(String(req.params.id), req.user!.id, req.ip);
  sendSuccess(res, level, "Role archived");
});

export const restore = asyncHandler(async (req: Request, res: Response) => {
  const level = await levelService.restoreLevel(String(req.params.id), req.user!.id, req.ip);
  sendSuccess(res, level, "Role restored");
});
