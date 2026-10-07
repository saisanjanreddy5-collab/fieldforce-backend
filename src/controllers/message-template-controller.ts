import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as messageTemplateService from "../services/message-template-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    channel?: messageTemplateService.TemplateChannel;
    page: number;
    limit: number;
  };
  sendSuccess(res, await messageTemplateService.listMessageTemplates(query));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const template = await messageTemplateService.createMessageTemplate(req.body);
  sendSuccess(res, template, "Template created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const template = await messageTemplateService.updateMessageTemplate(String(req.params.key), req.body);
  sendSuccess(res, template, "Template updated");
});
