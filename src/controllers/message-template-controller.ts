import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as messageTemplateService from "../services/message-template-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const channel = req.query.channel as messageTemplateService.TemplateChannel | undefined;
  sendSuccess(res, await messageTemplateService.listMessageTemplates(channel));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const template = await messageTemplateService.createMessageTemplate(req.body);
  sendSuccess(res, template, "Template created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const template = await messageTemplateService.updateMessageTemplate(String(req.params.key), req.body);
  sendSuccess(res, template, "Template updated");
});
