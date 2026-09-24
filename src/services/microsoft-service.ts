import jwt from "jsonwebtoken";
import { pool } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { GRAPH_BASE_URL, MS_SCOPES, isMicrosoftConfigured, msAuthorizeUrl, msTokenUrl } from "../config/microsoft";
import { createActivityForLead } from "./activity-service";
import { getLeadById } from "./lead-service";

interface ConnectionRow {
  user_id: string;
  ms_account_email: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  connected_at: string;
  updated_at: string;
}

interface StateClaims {
  purpose: "ms-oauth-state";
  userId: string;
  returnTo: string;
}

// Only ever a relative, in-app pathname - this round-trips through an
// unauthenticated browser redirect (Microsoft's own redirect back to us),
// and the original value came from a query param the client controls, so
// it must be validated before ever landing in a Location header. Rejects
// anything that could be interpreted as protocol-relative ("//evil.com")
// or absolute ("https://evil.com"), not just things missing a leading "/".
// Any query string or fragment on the original path is stripped rather
// than preserved, since this value gets ?microsoft=connected appended to
// it below - keeping it pathname-only avoids producing a malformed
// "?foo=bar?microsoft=connected" URL.
function sanitizeReturnTo(path: string | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return "/";
  }
  return path.split(/[?#]/)[0] || "/";
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function assertConfigured(): void {
  if (!isMicrosoftConfigured()) {
    throw new ApiError(503, "Microsoft 365 integration is not configured yet");
  }
}

// A short-lived, signed "state" carries which CRM user started the OAuth
// flow through Microsoft's redirect and back to our callback - the browser
// round-trip has no Authorization header for us to read the user from.
export function buildAuthUrl(userId: string, returnTo?: string): string {
  assertConfigured();

  const state = jwt.sign(
    { purpose: "ms-oauth-state", userId, returnTo: sanitizeReturnTo(returnTo) } as StateClaims,
    env.JWT_SECRET,
    { expiresIn: "10m" } as jwt.SignOptions
  );

  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID!,
    response_type: "code",
    redirect_uri: env.MS_REDIRECT_URI,
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state,
    // Without this, Microsoft silently reuses whatever Microsoft account
    // session is already cached in the browser - so a second CRM user
    // clicking Connect from the same browser as a first (who connected
    // earlier) ends up connecting the FIRST person's mailbox without ever
    // being asked, even though they're two different, correctly-isolated
    // CRM accounts. This forces the account picker every time, so who's
    // actually being connected is always an explicit choice, not whatever
    // happens to be cached.
    prompt: "select_account",
  });

  return `${msAuthorizeUrl()}?${params.toString()}`;
}

function decodeState(state: string): { userId: string; returnTo: string } {
  let claims: StateClaims;
  try {
    claims = jwt.verify(state, env.JWT_SECRET) as StateClaims;
  } catch {
    throw new ApiError(400, "This Microsoft sign-in link expired or is invalid - try connecting again");
  }
  if (claims.purpose !== "ms-oauth-state" || !claims.userId) {
    throw new ApiError(400, "Invalid Microsoft sign-in state");
  }
  return { userId: claims.userId, returnTo: sanitizeReturnTo(claims.returnTo) };
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID!,
    client_secret: env.MS_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.MS_REDIRECT_URI,
    scope: MS_SCOPES.join(" "),
  });

  const response = await fetch(msTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new ApiError(502, `Microsoft rejected the sign-in: ${await response.text()}`);
  }
  return (await response.json()) as TokenResponse;
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID!,
    client_secret: env.MS_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MS_SCOPES.join(" "),
  });

  const response = await fetch(msTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new ApiError(502, `Microsoft's token refresh failed: ${await response.text()}`);
  }
  return (await response.json()) as TokenResponse;
}

async function fetchMicrosoftEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GRAPH_BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new ApiError(502, "Could not read the connected Microsoft account's profile");
  }
  const profile = (await response.json()) as { mail?: string; userPrincipalName?: string };
  const email = profile.mail ?? profile.userPrincipalName;
  if (!email) {
    throw new ApiError(502, "The connected Microsoft account has no email address on file");
  }
  return email;
}

export async function handleOAuthCallback(code: string, state: string): Promise<{ email: string; returnTo: string }> {
  assertConfigured();
  const { userId, returnTo } = decodeState(state);
  const tokens = await exchangeCodeForTokens(code);

  if (!tokens.refresh_token) {
    throw new ApiError(502, "Microsoft did not return a refresh token - check that offline_access is granted");
  }

  const email = await fetchMicrosoftEmail(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await pool.query(
    `INSERT INTO microsoft_connections (user_id, ms_account_email, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       ms_account_email = EXCLUDED.ms_account_email,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       updated_at = now()`,
    [userId, email, tokens.access_token, tokens.refresh_token, expiresAt.toISOString()]
  );

  return { email, returnTo };
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; email: string | null }> {
  const result = await pool.query<ConnectionRow>("SELECT * FROM microsoft_connections WHERE user_id = $1", [userId]);
  const row = result.rows[0];
  return { connected: Boolean(row), email: row?.ms_account_email ?? null };
}

export async function disconnect(userId: string): Promise<void> {
  await pool.query("DELETE FROM microsoft_connections WHERE user_id = $1", [userId]);
}

// Refreshes eagerly once the stored token is within 2 minutes of expiry,
// rather than waiting for a live Graph call to fail with a 401 first.
async function getValidAccessToken(userId: string): Promise<string> {
  assertConfigured();

  const result = await pool.query<ConnectionRow>("SELECT * FROM microsoft_connections WHERE user_id = $1", [userId]);
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(409, "Connect your Microsoft 365 account first");
  }

  const expiresAt = new Date(row.token_expires_at).getTime();
  if (expiresAt - Date.now() > 2 * 60 * 1000) {
    return row.access_token;
  }

  const tokens = await refreshTokens(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await pool.query(
    `UPDATE microsoft_connections
     SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expires_at = $3, updated_at = now()
     WHERE user_id = $4`,
    [tokens.access_token, tokens.refresh_token ?? null, newExpiresAt.toISOString(), userId]
  );
  return tokens.access_token;
}

export async function sendMailForLead(
  leadId: string,
  subject: string,
  body: string,
  requestingUserId: string
): Promise<void> {
  const lead = await getLeadById(leadId, requestingUserId);
  if (!lead.email) {
    throw new ApiError(422, "This lead has no email address on file");
  }

  const accessToken = await getValidAccessToken(requestingUserId);

  const response = await fetch(`${GRAPH_BASE_URL}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: lead.email } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, `Microsoft rejected the email: ${await response.text()}`);
  }

  await createActivityForLead(
    leadId,
    { type: "email", subject, status: "completed", details: { body } },
    requestingUserId
  );
}

export async function createTeamsMeetingForLead(
  leadId: string,
  subject: string,
  startTime: string,
  endTime: string,
  requestingUserId: string
): Promise<{ joinUrl: string }> {
  const lead = await getLeadById(leadId, requestingUserId);
  if (!lead.email) {
    throw new ApiError(422, "This lead has no email address on file");
  }

  const accessToken = await getValidAccessToken(requestingUserId);

  // A dedicated "online meeting" (POST /me/onlineMeetings) needs the
  // OnlineMeetings.ReadWrite permission, which this app was never granted.
  // A calendar event with isOnlineMeeting:true only needs Calendars.ReadWrite
  // (already granted) and Microsoft attaches a Teams link to it the same way.
  // Adding the lead as an attendee (not just creating the meeting for
  // ourselves) is what makes Microsoft actually send them a real calendar
  // invite with the join link - same as inviting anyone to a normal meeting.
  const response = await fetch(`${GRAPH_BASE_URL}/me/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject,
      start: { dateTime: startTime, timeZone: "UTC" },
      end: { dateTime: endTime, timeZone: "UTC" },
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      attendees: [
        {
          emailAddress: { address: lead.email, name: lead.fullName },
          type: "required",
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, `Microsoft rejected the Teams meeting: ${await response.text()}`);
  }

  const event = (await response.json()) as { onlineMeeting: { joinUrl: string }; id: string };

  await createActivityForLead(
    leadId,
    {
      type: "teams_meeting",
      subject,
      dueDate: startTime,
      status: "pending",
      details: { joinUrl: event.onlineMeeting.joinUrl },
      externalRefId: event.id,
    },
    requestingUserId
  );

  return { joinUrl: event.onlineMeeting.joinUrl };
}
