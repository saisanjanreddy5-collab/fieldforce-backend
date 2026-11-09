import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as leadInquiryOptionService from "../services/lead-inquiry-option-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { fieldType?: "category" | "source" };
  sendSuccess(res, await leadInquiryOptionService.listLeadInquiryOptions(query.fieldType));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const option = await leadInquiryOptionService.createLeadInquiryOption(req.body);
  sendSuccess(res, option, "Option created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const option = await leadInquiryOptionService.updateLeadInquiryOption(String(req.params.id), req.body);
  sendSuccess(res, option, "Option updated");
});
