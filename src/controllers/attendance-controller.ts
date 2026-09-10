import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as attendanceService from "../services/attendance-service";

export const checkIn = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await attendanceService.checkIn(req.user!.id, req.body);
  sendSuccess(res, attendance, "Checked in", 201);
});

export const checkOut = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await attendanceService.checkOut(req.user!.id, req.body);
  sendSuccess(res, attendance, "Checked out");
});

export const status = asyncHandler(async (req: Request, res: Response) => {
  const result = await attendanceService.getStatus(req.user!.id);
  sendSuccess(res, result);
});

export const myHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await attendanceService.getMyHistory(req.user!.id);
  sendSuccess(res, history);
});

export const userHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await attendanceService.getUserHistory(String(req.params.userId), req.user!.id);
  sendSuccess(res, history);
});

export const teamStatus = asyncHandler(async (req: Request, res: Response) => {
  const team = await attendanceService.getTeamStatus(req.user!.id);
  sendSuccess(res, team);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await attendanceService.getAttendanceById(String(req.params.id), req.user!.id);
  sendSuccess(res, attendance);
});

export const distance = asyncHandler(async (req: Request, res: Response) => {
  const result = await attendanceService.getDistanceForAttendance(String(req.params.id), req.user!.id);
  sendSuccess(res, result);
});

export const locationPing = asyncHandler(async (req: Request, res: Response) => {
  await attendanceService.recordLocationPing(req.user!.id, req.body.latitude, req.body.longitude);
  sendSuccess(res, null, "Location recorded", 201);
});
