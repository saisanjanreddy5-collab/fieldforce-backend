import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as approvalsInboxService from "../services/approvals-inbox-service";

export const getInbox = asyncHandler(async (req: Request, res: Response) => {
  const inbox = await approvalsInboxService.getApprovalInbox(req.user!.id, req.user!.role);
  sendSuccess(res, inbox);
});
