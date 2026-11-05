import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as approvalsInboxService from "../services/approvals-inbox-service";

export const getInbox = asyncHandler(async (req: Request, res: Response) => {
  const inbox = await approvalsInboxService.getApprovalInbox(req.user!.id, req.user!.role);
  sendSuccess(res, inbox);
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.validatedQuery as unknown as { page: number; limit: number };
  const history = await approvalsInboxService.getApprovalHistory(req.user!.id, req.user!.role, page, limit);
  sendSuccess(res, history);
});
