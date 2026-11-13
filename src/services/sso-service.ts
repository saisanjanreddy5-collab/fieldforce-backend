import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

// Long-lived "is this browser already logged into FieldForce" proof, read by
// GET /sso/authorize so a second visit (Frappe redirecting back here) never
// has to show a login form again. Deliberately its own secret/claim shape
// (not signAccessToken's), signed with JWT_REFRESH_SECRET - that secret
// already means "long-lived session proof" everywhere else in this codebase
// (refresh_tokens), which is exactly the right trust level for this cookie
// too, so no new secret was worth adding just for this.
const SSO_SESSION_COOKIE = "ff_sso_session";
const SSO_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // matches JWT_REFRESH_EXPIRES_IN's default (7d)
const AUTH_CODE_TTL_MS = 60 * 1000; // just long enough for the two redirects to happen
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
// Frappe Cloud's own infra has been observed turning one incoming callback
// into two outgoing calls to this endpoint (confirmed via direct curl
// testing - a single request to Frappe's callback URL still produced two
// hits here, even though this endpoint's own logic is correct in isolation).
// The code already proved itself legitimate on its first use, so a
// near-instant repeat of the *same* code reissues a fresh token instead of
// failing the whole login over infra outside our control.
const CODE_REPLAY_GRACE_MS = 10 * 1000;

interface SsoSessionPayload {
  id: string;
  purpose: "sso_session";
}

interface SsoAccessTokenPayload {
  sub: string;
  aud: "frappe-helpdesk";
}

export function signSsoSessionCookie(userId: string): string {
  return jwt.sign({ id: userId, purpose: "sso_session" } satisfies SsoSessionPayload, env.JWT_REFRESH_SECRET, {
    expiresIn: SSO_SESSION_MAX_AGE_MS / 1000,
  });
}

export const SSO_SESSION_COOKIE_NAME = SSO_SESSION_COOKIE;
export const SSO_SESSION_COOKIE_MAX_AGE_MS = SSO_SESSION_MAX_AGE_MS;

// Returns the logged-in user's id, or null if there's no cookie / it's
// expired / it's not actually one of ours - every case just means "treat
// this visitor as logged out," never an error.
export function readSsoSessionCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  try {
    const payload = jwt.verify(cookieValue, env.JWT_REFRESH_SECRET) as SsoSessionPayload;
    return payload.purpose === "sso_session" ? payload.id : null;
  } catch {
    return null;
  }
}

function requireSsoConfigured(): { clientId: string; clientSecret: string; redirectUri: string; tokenSecret: string } {
  const { SSO_FRAPPE_CLIENT_ID, SSO_FRAPPE_CLIENT_SECRET, SSO_FRAPPE_REDIRECT_URI, SSO_TOKEN_SECRET } = env;
  if (!SSO_FRAPPE_CLIENT_ID || !SSO_FRAPPE_CLIENT_SECRET || !SSO_FRAPPE_REDIRECT_URI || !SSO_TOKEN_SECRET) {
    throw new ApiError(503, "SSO is not configured on this server yet");
  }
  return {
    clientId: SSO_FRAPPE_CLIENT_ID,
    clientSecret: SSO_FRAPPE_CLIENT_SECRET,
    redirectUri: SSO_FRAPPE_REDIRECT_URI,
    tokenSecret: SSO_TOKEN_SECRET,
  };
}

// Step 1 of the redirect dance: FieldForce already knows who the user is
// (readSsoSessionCookie above), so it hands back a one-time code instead of
// a token directly - the code travels through the user's browser (visible in
// a URL bar / server log), the real token only ever travels server-to-server
// at exchangeCodeForToken, which is the whole point of the Authorization
// Code grant over a simpler Implicit one.
export async function createAuthorizationCode(userId: string, clientId: string, redirectUri: string): Promise<string> {
  const { clientId: expectedClientId, redirectUri: expectedRedirectUri } = requireSsoConfigured();
  if (clientId !== expectedClientId) {
    throw new ApiError(400, "Unknown client_id");
  }
  if (redirectUri !== expectedRedirectUri) {
    throw new ApiError(400, "redirect_uri does not match what's configured for this client");
  }

  const code = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sso_authorization_codes (code, user_id, redirect_uri, expires_at) VALUES ($1, $2, $3, $4)`,
    [code, userId, redirectUri, new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString()]
  );
  return code;
}

// Step 2, called by Frappe's own server (not the user's browser) - the
// client_secret check here is what makes this safe despite the code having
// briefly passed through the browser: whoever calls this must already know
// a secret that never goes near the browser at all.
export async function exchangeCodeForToken(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId: expectedClientId, clientSecret: expectedClientSecret, tokenSecret } = requireSsoConfigured();

  if (params.clientId !== expectedClientId || params.clientSecret !== expectedClientSecret) {
    throw new ApiError(401, "Invalid client credentials");
  }

  const result = await pool.query<{ user_id: string; redirect_uri: string; expires_at: string; used_at: string | null }>(
    `SELECT user_id, redirect_uri, expires_at, used_at FROM sso_authorization_codes WHERE code = $1`,
    [params.code]
  );
  const row = result.rows[0];
  if (!row || row.redirect_uri !== params.redirectUri) {
    throw new ApiError(400, "Invalid, expired, or already-used authorization code");
  }

  if (row.used_at !== null) {
    if (Date.now() - new Date(row.used_at).getTime() > CODE_REPLAY_GRACE_MS) {
      throw new ApiError(400, "Invalid, expired, or already-used authorization code");
    }
    return issueSsoAccessToken(row.user_id, tokenSecret);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new ApiError(400, "Invalid, expired, or already-used authorization code");
  }

  await pool.query(`UPDATE sso_authorization_codes SET used_at = now() WHERE code = $1`, [params.code]);
  return issueSsoAccessToken(row.user_id, tokenSecret);
}

function issueSsoAccessToken(userId: string, tokenSecret: string): { accessToken: string; expiresIn: number } {
  const accessToken = jwt.sign({ sub: userId, aud: "frappe-helpdesk" } satisfies SsoAccessTokenPayload, tokenSecret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

// Step 3, also called by Frappe's own server - Frappe matches/creates its
// own User by the email returned here (confirmed against Frappe's own
// login_via_oauth2 behavior), so email is the one field that actually has to
// be right; name is cosmetic.
export async function getUserInfoFromAccessToken(authorizationHeader: string | undefined): Promise<{ email: string; name: string }> {
  const { tokenSecret } = requireSsoConfigured();

  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing or invalid Authorization header");
  }
  const token = authorizationHeader.slice("Bearer ".length);

  let payload: SsoAccessTokenPayload;
  try {
    payload = jwt.verify(token, tokenSecret) as SsoAccessTokenPayload;
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }
  if (payload.aud !== "frappe-helpdesk") {
    throw new ApiError(401, "Invalid access token");
  }

  const result = await pool.query<{ email: string; name: string; is_active: boolean }>(
    `SELECT email, name, is_active FROM users WHERE id = $1`,
    [payload.sub]
  );
  const user = result.rows[0];
  if (!user || !user.is_active) {
    throw new ApiError(401, "User no longer active");
  }
  return { email: user.email, name: user.name };
}
