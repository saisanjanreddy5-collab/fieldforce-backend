// TEMPORARY local verification for the new FieldForce-as-OAuth2-identity-
// provider flow (GET /sso/authorize, POST /sso/token, GET /sso/userinfo)
// that Frappe Helpdesk's "Social Login Key" (provider: Custom) will call.
// Needs the real dev server running on :8000 (hits it over real HTTP, since
// the whole point is to prove cookies/redirects/headers round-trip
// correctly - calling the service functions directly would prove nothing).
// Creates one throwaway user, deletes it when done either way.
import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { env } from "../config/env";

const BASE_URL = `http://localhost:${env.PORT}/api`;
const TEST_EMAIL = `sso-test-${Date.now()}@test.local`;
const TEST_PASSWORD = "Test@12345";

let passed = 0;
let failed = 0;

function assertCheck(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.log(`FAIL: ${message}`);
  }
}

async function main(): Promise<void> {
  if (!env.SSO_FRAPPE_CLIENT_ID || !env.SSO_FRAPPE_CLIENT_SECRET || !env.SSO_FRAPPE_REDIRECT_URI) {
    throw new Error("SSO_FRAPPE_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI must be set in .env to run this test");
  }
  const clientId = env.SSO_FRAPPE_CLIENT_ID;
  const clientSecret = env.SSO_FRAPPE_CLIENT_SECRET;
  const redirectUri = env.SSO_FRAPPE_REDIRECT_URI;

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
    ["SSO Test User", TEST_EMAIL, passwordHash]
  );
  const userId = userResult.rows[0].id;

  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    assertCheck(loginRes.status === 200, "Login succeeds for the fresh test user");
    const setCookieHeader = loginRes.headers.get("set-cookie") ?? "";
    const sessionCookieMatch = setCookieHeader.match(/ff_sso_session=([^;]+)/);
    assertCheck(!!sessionCookieMatch, "Login response sets the ff_sso_session cookie");
    const sessionCookie = `ff_sso_session=${sessionCookieMatch?.[1] ?? ""}`;
    const loginBody = (await loginRes.json()) as { data: { accessToken: string } };

    const authorizeUrl = `${BASE_URL}/sso/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=xyz123`;

    const noCookieRes = await fetch(authorizeUrl, { redirect: "manual" });
    const noCookieLocation = noCookieRes.headers.get("location") ?? "";
    assertCheck(
      noCookieRes.status === 302 && noCookieLocation.includes("/login?ssoContinue="),
      "Authorize with no session cookie bounces to the login page with ssoContinue"
    );

    const authorizeRes = await fetch(authorizeUrl, { redirect: "manual", headers: { Cookie: sessionCookie } });
    const location = authorizeRes.headers.get("location") ?? "";
    assertCheck(
      authorizeRes.status === 302 && location.startsWith(redirectUri),
      "Authorize with a valid session redirects to Frappe's configured redirect_uri"
    );
    const code = location.match(/[?&]code=([^&]+)/)?.[1] ?? "";
    assertCheck(code.length > 0, "Redirect URL carries a code");
    assertCheck(location.match(/[?&]state=([^&]+)/)?.[1] === "xyz123", "Redirect URL carries the original state untouched");

    const wrongRedirectRes = await fetch(
      `${BASE_URL}/sso/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://evil.example.com/callback")}&state=x`,
      { headers: { Cookie: sessionCookie } }
    );
    assertCheck(wrongRedirectRes.status === 400, "Authorize rejects a redirect_uri that doesn't match what's configured");

    const wrongSecretRes = await fetch(`${BASE_URL}/sso/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: "wrong-secret" }),
    });
    assertCheck(wrongSecretRes.status === 401, "Token exchange rejects a wrong client_secret");

    const tokenRes = await fetch(`${BASE_URL}/sso/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
    });
    assertCheck(tokenRes.status === 200, "Token exchange succeeds with the right code + client credentials");
    const tokenBody = (await tokenRes.json()) as { access_token?: string; token_type?: string };
    assertCheck(typeof tokenBody.access_token === "string" && tokenBody.token_type === "bearer", "Token response has access_token + token_type=bearer");

    const reuseRes = await fetch(`${BASE_URL}/sso/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
    });
    assertCheck(reuseRes.status === 400, "Re-using the same code a second time is rejected (single use)");

    const userinfoRes = await fetch(`${BASE_URL}/sso/userinfo`, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
    assertCheck(userinfoRes.status === 200, "Userinfo succeeds with a valid access token");
    const userinfoBody = (await userinfoRes.json()) as { email?: string };
    assertCheck(userinfoBody.email === TEST_EMAIL, "Userinfo returns the same email Frappe matches the account by");

    const badTokenRes = await fetch(`${BASE_URL}/sso/userinfo`, { headers: { Authorization: "Bearer not-a-real-token" } });
    assertCheck(badTokenRes.status === 401, "Userinfo rejects a garbage access token");

    const crossRes = await fetch(`${BASE_URL}/sso/userinfo`, { headers: { Authorization: `Bearer ${loginBody.data.accessToken}` } });
    assertCheck(crossRes.status === 401, "A normal FieldForce app access token is rejected by /sso/userinfo (separate trust boundary holds)");
  } finally {
    await pool.query("DELETE FROM sso_authorization_codes WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
