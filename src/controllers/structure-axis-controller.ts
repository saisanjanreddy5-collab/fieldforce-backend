import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as structureAxisService from "../services/structure-axis-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const axes = await structureAxisService.listStructureAxes();
  sendSuccess(res, axes);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const axis = await structureAxisService.setAxisEnabled(String(req.params.id), Boolean(req.body.isEnabled));
  sendSuccess(res, axis, "Structure axis updated");
});
