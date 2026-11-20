import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { ApiError } from "../utils/api-error";
import { env } from "../config/env";
import * as ssoService from "../services/sso-service";

// All three handlers below speak the plain OAuth2 wire format Frappe's generic
// "Social Login Key" (provider: Custom) expects - snake_case JSON, no
// {success, data} envelope - since the consumer here is Frappe's own OAuth2
// client code, not our frontend. That's a deliberate exception to this
// codebase's usual sendSuccess()/sendError() convention everywhere else.

// This endpoint's own public URL for the current request - built from the
// configured public address when one is set, because behind nginx
// req.protocol/host can read "http" / "localhost:8000", and the CRM login
// page (safeSsoContinue) rightly refuses to send anyone back to such a link.
function selfUrl(req: Request): string {
  const publicBase = process.env.PUBLIC_BACKEND_BASE_URL?.replace(/\/+$/, "");
  return `${publicBase || `${req.protocol}://${req.get("host")}`}${req.originalUrl}`;
}

function redirectToCrmLogin(req: Request, res: Response): void {
  res.redirect(`${env.FRONTEND_URL}/login?ssoContinue=${encodeURIComponent(selfUrl(req))}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

// A plain, branded page instead of a raw JSON error - someone without
// Helpdesk access (e.g. Call Center) who reaches this flow lands here, in a
// normal browser tab.
function sendNoHelpdeskAccess(res: Response): void {
  const back = escapeHtml(env.FRONTEND_URL);
  res
    .status(403)
    .type("html")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No access to Support</title></head>` +
        `<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">` +
        `<div style="max-width:420px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;text-align:center">` +
        `<h1 style="font-size:20px;margin:0 0 8px;color:#111827">No access to Support tickets</h1>` +
        `<p style="color:#4b5563;font-size:14px;line-height:1.5;margin:0 0 20px">Your FieldForce account doesn't have access to the support helpdesk. If you think you need it, ask your administrator.</p>` +
        `<a href="${back}" style="display:inline-block;background:#1354e0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Back to FieldForce</a>` +
        `</div></body></html>`
    );
}

// The CRM's "Support tickets" link: one click from the CRM straight into
// Frappe Helpdesk with no Frappe login form. Frappe 16 only accepts a login
// it started itself, so this asks Frappe for a fresh "Login with FieldForce"
// link (carrying Frappe's own login state) and sends the browser to it -
// Frappe then calls /sso/authorize below, which recognises the CRM session
// cookie and logs the user straight in.
export const launch = asyncHandler(async (req: Request, res: Response) => {
  const userId = ssoService.readSsoSessionCookie(req.cookies?.[ssoService.SSO_SESSION_COOKIE_NAME]);
  if (!userId) {
    redirectToCrmLogin(req, res);
    return;
  }
  if (!(await ssoService.canUseHelpdesk(userId))) {
    sendNoHelpdeskAccess(res);
    return;
  }
  const landing = ssoService.safeHelpdeskPath(req.query.to);
  const oneClick = await ssoService.getFrappeOneClickLoginUrl(landing);
  const fallback = ssoService.frappeLoginPageUrl(landing);
  if (!oneClick && !fallback) {
    throw new ApiError(503, "Support helpdesk is not configured on this server yet");
  }
  res.redirect((oneClick ?? fallback)!);
});

// A customer's page for an invite link that no longer works - points them at
// the portal's normal sign-in (email them a one-time link), never a dead end.
function sendInviteExpired(res: Response): void {
  const portal = ssoService.frappeLoginPageUrl("/helpdesk/my-tickets");
  const button = portal
    ? `<a href="${escapeHtml(portal)}" style="display:inline-block;background:#1354e0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Go to the support portal</a>`
    : "";
  res
    .status(410)
    .type("html")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title></head>` +
        `<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">` +
        `<div style="max-width:420px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;text-align:center">` +
        `<h1 style="font-size:20px;margin:0 0 8px;color:#111827">This sign-in link has expired</h1>` +
        `<p style="color:#4b5563;font-size:14px;line-height:1.5;margin:0 0 20px">No problem - open the support portal and sign in with your email address. We'll email you a one-time sign-in link, no password needed.</p>` +
        button +
        `</div></body></html>`
    );
}

// The one-click link in a customer's support-portal invite email: proves who
// they are, then takes the same route into Frappe as an employee's launch -
// /sso/authorize below recognises the short-lived customer cookie.
export const customerInvite = asyncHandler(async (req: Request, res: Response) => {
  const customerId = await ssoService.redeemCustomerInvite(req.query.t);
  if (!customerId) {
    sendInviteExpired(res);
    return;
  }
  res.cookie(ssoService.SSO_CUSTOMER_COOKIE_NAME, ssoService.signSsoCustomerCookie(customerId), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ssoService.SSO_CUSTOMER_COOKIE_MAX_AGE,
    path: "/api/sso",
  });
  const landing = "/helpdesk/my-tickets";
  const oneClick = await ssoService.getFrappeOneClickLoginUrl(landing);
  if (!oneClick) {
    res.clearCookie(ssoService.SSO_CUSTOMER_COOKIE_NAME, { path: "/api/sso" });
    sendInviteExpired(res);
    return;
  }
  res.redirect(oneClick);
});

export const authorize = asyncHandler(async (req: Request, res: Response) => {
  const { response_type, client_id, redirect_uri, state } = req.query as Record<string, string | undefined>;

  if (response_type !== "code" || !client_id || !redirect_uri) {
    throw new ApiError(400, "Missing or unsupported response_type/client_id/redirect_uri");
  }

  // A customer arriving from their invite link (set moments ago by
  // customerInvite). One-shot: cleared here so it can't be reused, and it
  // takes priority over any employee session in the same browser - the
  // person clicking an invite link wants to be that customer.
  const customerId = ssoService.readSsoCustomerCookie(req.cookies?.[ssoService.SSO_CUSTOMER_COOKIE_NAME]);
  if (customerId) {
    res.clearCookie(ssoService.SSO_CUSTOMER_COOKIE_NAME, { path: "/api/sso" });
    if (await ssoService.isActivePortalCustomer(customerId)) {
      const code = await ssoService.createAuthorizationCode({ kind: "customer", id: customerId }, client_id, redirect_uri);
      const callback = new URL(redirect_uri);
      callback.searchParams.set("code", code);
      if (state) callback.searchParams.set("state", state);
      res.redirect(callback.toString());
      return;
    }
  }

  const userId = ssoService.readSsoSessionCookie(req.cookies?.[ssoService.SSO_SESSION_COOKIE_NAME]);

  if (!userId) {
    // Not logged into FieldForce in this browser yet - send them to the
    // normal login page, with this exact URL as where to come back to once
    // they have. The login page itself does a full-page redirect back here
    // (not an SPA navigate) once login succeeds, so this handler runs again
    // and takes the branch below.
    redirectToCrmLogin(req, res);
    return;
  }

  // Blocks anyone whose role has no Support access (Call Center) even if
  // they try Frappe's own "Login with FieldForce" button directly.
  if (!(await ssoService.canUseHelpdesk(userId))) {
    sendNoHelpdeskAccess(res);
    return;
  }

  const code = await ssoService.createAuthorizationCode({ kind: "user", id: userId }, client_id, redirect_uri);
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
