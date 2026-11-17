import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  CORS_ALLOWED_ORIGINS: z.string().default(""),

  // Microsoft 365 integration (Outlook mail + Teams meetings) - each
  // salesperson connects their own Microsoft account via delegated OAuth;
  // these three identify our app registration to Microsoft, they don't
  // belong to any one user. Optional at the env level (not every
  // environment has this configured yet, e.g. production until its own
  // .env is updated) - services check for their presence at call time
  // instead of crashing the whole server on startup.
  MS_TENANT_ID: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_REDIRECT_URI: z.string().default("http://localhost:8000/api/integrations/microsoft/callback"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),

  // This server's own public address, with no path. Needed wherever a
  // third party has to fetch a file back from us over the open internet
  // (K3 downloading a WhatsApp attachment we're sending) rather than us
  // calling out to them - nothing else in this codebase has needed that
  // before, since every other integration here is the client, not the
  // server, from the third party's point of view.
  PUBLIC_BACKEND_BASE_URL: z.string().default("http://localhost:8000"),

  // Smartflo (Tata Tele) click-to-call - a single static API token for the
  // whole account, not per-user like Microsoft 365. Optional for the same
  // reason as the MS_ vars above.
  SMARTFLO_API_TOKEN: z.string().optional(),

  // Shared secret Smartflo sends back as a custom header on its webhook
  // (configured in their dashboard under API Connect > Webhook) so the
  // public /api/integrations/smartflo/webhook route can tell a genuine
  // Smartflo callback apart from a random internet request. Optional only so
  // the app can boot before this is configured - the webhook itself fails
  // closed (rejects everything) while it's unset, it does not run unguarded.
  SMARTFLO_WEBHOOK_SECRET: z.string().optional(),

  // WhatsApp Business messaging via K3 Digital Media's Pinbot.ai platform -
  // a single account-level key + WABA number/phone number id for the whole
  // org, not per-user (same shape as the Smartflo vars above). Optional for
  // the same reason as SMARTFLO_API_TOKEN.
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_WANUMBER: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Shared secret we expect back as a custom header on K3's webhook
  // (registered via their /v2/setwebhooks endpoint) so the public
  // /api/integrations/whatsapp/webhook route can tell a genuine callback
  // apart from a random internet request - same pattern, and same
  // fail-closed-when-unset behavior, as SMARTFLO_WEBHOOK_SECRET.
  WHATSAPP_WEBHOOK_SECRET: z.string().optional(),

  // SKIA FOFO's own store-app user registration API (a separate Nextech
  // product, not part of this CRM) - "Push to onboarding app" on a FOFO
  // lead calls this to actually create the store owner's app login, instead
  // of only recording a local reference code as it did before this existed.
  // Defaults to their test/staging server (everydaycpos) per their own
  // instructions: verify the user shows up there first, then point this at
  // their production ("centralskia") URL once confirmed. CMR_TOKEN is the
  // auth token their side issued for this integration - optional so the app
  // still boots before it's configured, same as every other integration
  // above; the call itself fails closed (a clear error, not a silent no-op)
  // while unset.
  SKIA_FOFO_REGISTRATION_URL: z.string().default("https://everydaycpos.nextechltd.in/api/cpos/app/user/registration"),
  SKIA_FOFO_CMR_TOKEN: z.string().optional(),

  // SSO - FieldForce acts as the OAuth2 identity provider for Frappe
  // Helpdesk's "Social Login Key" (provider type Custom), so field/admin
  // employees and customers log in once here and Helpdesk trusts that
  // session instead of asking for a second password. CLIENT_ID/SECRET are
  // whatever we generate and hand to the Frappe admin to paste into that
  // Social Login Key; REDIRECT_URI is the exact callback URL Frappe computes
  // from the key's name (see adding-social-login-provider docs) - must match
  // byte-for-byte or /sso/authorize rejects the request. TOKEN_SECRET signs
  // the short-lived access token handed to Frappe at /sso/token - kept apart
  // from JWT_SECRET/JWT_REFRESH_SECRET on purpose: those two are trusted by
  // requireAuth() for every normal API call, so a leaked Frappe-side token
  // must never verify against that secret and get treated as a real session.
  // All optional so the app still boots before this is configured, same as
  // every other integration above; the routes themselves fail closed with a
  // clear error while unset, never silently.
  SSO_FRAPPE_CLIENT_ID: z.string().optional(),
  SSO_FRAPPE_CLIENT_SECRET: z.string().optional(),
  SSO_FRAPPE_REDIRECT_URI: z.string().optional(),
  SSO_TOKEN_SECRET: z.string().optional(),
});

// Settings whose built-in default only makes sense on a developer's own
// machine (localhost, or SKIA's TEST registration server). Not fatal - a
// server must never fail to start over this - but printed loudly at boot,
// because on a real server each one silently breaks something: WhatsApp
// attachments, Microsoft sign-in redirects, FOFO store registration going
// to the test system, or the login cookie not being marked Secure.
const DEV_ONLY_DEFAULTS: { key: string; effect: string }[] = [
  { key: "NODE_ENV", effect: "login/SSO cookies are not marked Secure (set NODE_ENV=production on a server)" },
  { key: "FRONTEND_URL", effect: "Microsoft connect / SSO send users back to http://localhost:5173" },
  { key: "PUBLIC_BACKEND_BASE_URL", effect: "WhatsApp attachments get http://localhost:8000 links that K3/customers can't open" },
  { key: "MS_REDIRECT_URI", effect: "Microsoft 365 sign-in redirects to localhost and fails" },
  { key: "SKIA_FOFO_REGISTRATION_URL", effect: "FOFO 'push to onboarding app' registers stores on SKIA's TEST server" },
];
const missingDevDefaults = DEV_ONLY_DEFAULTS.filter(({ key }) => !process.env[key]);
if (missingDevDefaults.length > 0) {
  console.warn(
    [
      "WARNING - these settings are not set in .env and are using development defaults:",
      ...missingDevDefaults.map(({ key, effect }) => `  - ${key}: ${effect}`),
      "  (Fine on a developer machine; on devcrm/skiacrm set them in .env.)",
    ].join("\n")
  );
}

// Weak or shared JWT secrets: if the access and refresh secrets are the
// same, a short-lived access token would also verify as a (legacy, no-jti)
// refresh token - see auth-service.ts's refreshAccessToken, which refuses
// that case - and short secrets are guessable. Loud warning, not a crash.
{
  const access = process.env.JWT_SECRET ?? "";
  const refresh = process.env.JWT_REFRESH_SECRET ?? "";
  if (access && refresh && access === refresh) {
    console.warn("WARNING - JWT_SECRET and JWT_REFRESH_SECRET are identical. Set two different long random values in .env.");
  }
  if ((access && access.length < 32) || (refresh && refresh.length < 32)) {
    console.warn("WARNING - JWT_SECRET / JWT_REFRESH_SECRET are shorter than 32 characters. Use long random values in .env.");
  }
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  CORS_ALLOWED_ORIGINS: parsed.data.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
};
