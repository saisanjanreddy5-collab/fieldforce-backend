import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as pipelineStageService from "../services/pipeline-stage-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await pipelineStageService.listPipelineStages());
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const stage = await pipelineStageService.createPipelineStage(req.body);
  sendSuccess(res, stage, "Stage created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const stage = await pipelineStageService.updatePipelineStage(String(req.params.key), req.body);
  sendSuccess(res, stage, "Stage updated");
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const stages = await pipelineStageService.reorderPipelineStages(req.body.orderedKeys);
  sendSuccess(res, stages, "Stages reordered");
});
