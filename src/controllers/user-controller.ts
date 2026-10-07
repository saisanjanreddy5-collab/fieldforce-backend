import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as userService from "../services/user-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  const result = await userService.listUsers(req.user!.id, req.user!.role, query);
  sendSuccess(res, result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, user, "User updated");
});

// Preview only - registerUser assigns the real one itself at creation time
// (whatever the highest real code is +1 at that exact moment), so this is
// just what the Create user form shows while someone's filling it out, not
// a reservation. If two admins happen to create a user in the same instant,
// whichever request's INSERT lands first gets this exact code; the other
// gets the next one up, same as the preview would show if they'd refreshed.
export const nextEmployeeCode = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, { employeeCode: await userService.getNextEmployeeCode() });
});

export const listTerritories = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await userService.listDistinctTerritories());
});

// Self-service - always targets the authenticated caller's own id, never
// req.params, so the narrow updateOwnProfileSchema is the only thing
// standing between this and the admin-only update() above.
export const updateOwnProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(req.user!.id, req.body, req.user!.id);
  sendSuccess(res, user, "Profile updated");
});
