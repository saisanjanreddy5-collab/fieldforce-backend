import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as authService from "../services/auth-service";
import { env } from "../config/env";
import { SSO_SESSION_COOKIE_MAX_AGE_MS, SSO_SESSION_COOKIE_NAME, signSsoSessionCookie } from "../services/sso-service";

// Lax, not None - this cookie only ever needs to survive a top-level GET
// redirect FROM Frappe's domain TO ours (the browser landing on
// GET /api/sso/authorize), which Lax already allows; it's never read from a
// cross-site fetch/XHR, so there's no reason to loosen it further.
function setSsoSessionCookie(res: Response, userId: string): void {
  res.cookie(SSO_SESSION_COOKIE_NAME, signSsoSessionCookie(userId), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SSO_SESSION_COOKIE_MAX_AGE_MS,
  });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.registerUser(req.body);
  sendSuccess(res, user, "User created", 201);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await authService.loginUser(email, password);
  setSsoSessionCookie(res, result.user.id);
  sendSuccess(res, result, "Login successful");
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshAccessToken(refreshToken);
  sendSuccess(res, result, "Token refreshed");
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  await authService.logoutUser(refreshToken);
  res.clearCookie(SSO_SESSION_COOKIE_NAME);
  sendSuccess(res, null, "Logged out");
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getUserById(req.user!.id);
  sendSuccess(res, user);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changeOwnPassword(req.user!.id, currentPassword, newPassword);
  sendSuccess(res, null, "Password changed - please log in again");
});
