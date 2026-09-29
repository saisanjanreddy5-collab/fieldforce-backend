import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as leaveService from "../services/leave-service";

export const listTypes = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await leaveService.listLeaveTypes());
});

export const updateType = asyncHandler(async (req: Request, res: Response) => {
  const key = req.params.key as leaveService.LeaveTypeKey;
  sendSuccess(res, await leaveService.updateLeaveType(key, req.body), "Leave type updated");
});

export const getMyBalances = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await leaveService.getBalances(req.user!.id));
});

export const getContext = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await leaveService.getLeaveContext(req.user!.id));
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await leaveService.listMyRequests(req.user!.id));
});

export const listTeam = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await leaveService.listTeamRequests(req.user!.id));
});

export const listPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await leaveService.listPendingApprovals(req.user!.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const request = await leaveService.createLeaveRequest(req.user!.id, req.body);
  sendSuccess(res, request, "Leave request submitted", 201);
});

export const decide = asyncHandler(async (req: Request, res: Response) => {
  const request = await leaveService.decideLeaveRequest(String(req.params.id), req.user!.id, req.body.decision, req.ip);
  sendSuccess(res, request, `Request ${req.body.decision}`);
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const request = await leaveService.cancelLeaveRequest(String(req.params.id), req.user!.id);
  sendSuccess(res, request, "Leave request cancelled");
});

export const grantCompOff = asyncHandler(async (req: Request, res: Response) => {
  const balances = await leaveService.grantCompOff(req.user!.id, req.body);
  sendSuccess(res, balances, "Comp-off granted", 201);
});
