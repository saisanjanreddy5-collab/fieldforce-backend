import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as rolePermissionService from "../services/role-permission-service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const matrix = await rolePermissionService.listRolePermissionMatrix();
  sendSuccess(res, matrix);
});

export const setGrant = asyncHandler(async (req: Request, res: Response) => {
  const { role, permission, granted } = req.body;
  await rolePermissionService.setRolePermission(role, permission, Boolean(granted));
  const matrix = await rolePermissionService.listRolePermissionMatrix();
  sendSuccess(res, matrix, "Role permissions updated");
});

export const resetToDefault = asyncHandler(async (req: Request, res: Response) => {
  await rolePermissionService.resetRoleToDefault(req.body.role);
  const matrix = await rolePermissionService.listRolePermissionMatrix();
  sendSuccess(res, matrix, "Role reset to default");
});
