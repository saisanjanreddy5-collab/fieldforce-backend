import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { sendSuccess } from "../utils/response";
import * as approvalsInboxService from "../services/approvals-inbox-service";

export const getInbox = asyncHandler(async (req: Request, res: Response) => {
  const inbox = await approvalsInboxService.getApprovalInbox(req.user!.id);
  sendSuccess(res, inbox);
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.validatedQuery as unknown as { page: number; limit: number };
  const history = await approvalsInboxService.getApprovalHistory(req.user!.id, page, limit);
  sendSuccess(res, history);
});
