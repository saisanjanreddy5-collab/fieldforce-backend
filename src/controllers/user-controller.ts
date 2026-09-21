import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as userService from "../services/user-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const users = await userService.listUsers(req.user!.id, req.user!.role);
  sendSuccess(res, users);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, user, "User updated");
});
