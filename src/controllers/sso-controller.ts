import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import * as ssoService from "../services/sso-service";

// All three handlers below speak the plain OAuth2 wire format Frappe's generic
// "Social Login Key" (provider: Custom) expects - snake_case JSON, no
// {success, data} envelope - since the consumer here is Frappe's own OAuth2
// client code, not our frontend. That's a deliberate exception to this
// codebase's usual sendSuccess()/sendError() convention everywhere else.

export const authorize = asyncHandler(async (req: Request, res: Response) => {
  const { response_type, client_id, redirect_uri, state } = req.query as Record<string, string | undefined>;

  if (response_type !== "code" || !client_id || !redirect_uri) {
    throw new ApiError(400, "Missing or unsupported response_type/client_id/redirect_uri");
  }

  const userId = ssoService.readSsoSessionCookie(req.cookies?.[ssoService.SSO_SESSION_COOKIE_NAME]);

  if (!userId) {
    // Not logged into FieldForce in this browser yet - send them to the
    // normal login page, with this exact URL as where to come back to once
    // they have. The login page itself does a full-page redirect back here
    // (not an SPA navigate) once login succeeds, so this handler runs again
    // and takes the branch below.
    const selfUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const loginUrl = `${env.FRONTEND_URL}/login?ssoContinue=${encodeURIComponent(selfUrl)}`;
    res.redirect(loginUrl);
    return;
  }

  const code = await ssoService.createAuthorizationCode(userId, client_id, redirect_uri);
  const callback = new URL(redirect_uri);
  callback.searchParams.set("code", code);
  if (state) callback.searchParams.set("state", state);
  res.redirect(callback.toString());
});

export const token = asyncHandler(async (req: Request, res: Response) => {
  const { grant_type, code, redirect_uri, client_id, client_secret } = req.body as Record<string, string | undefined>;

  if (grant_type !== "authorization_code" || !code || !redirect_uri || !client_id || !client_secret) {
    throw new ApiError(400, "Missing or unsupported grant_type/code/redirect_uri/client_id/client_secret");
  }

  const { accessToken, expiresIn } = await ssoService.exchangeCodeForToken({ code, clientId: client_id, clientSecret: client_secret, redirectUri: redirect_uri });

  res.json({ access_token: accessToken, token_type: "bearer", expires_in: expiresIn });
});

export const userinfo = asyncHandler(async (req: Request, res: Response) => {
  const info = await ssoService.getUserInfoFromAccessToken(req.headers.authorization);
  res.json({ email: info.email, name: info.name });
});
