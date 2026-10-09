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

  // Frappe Helpdesk (Support tickets) - our own dedicated Frappe Cloud site,
  // one account for the whole org, not per-user. Unlike Smartflo/WhatsApp
  // above, the base URL itself has no fixed vendor constant - it's our own
  // site's address, so it's configured here rather than hardcoded next to a
  // BASE_URL constant in config/frappe.ts. Auth is Frappe's token scheme
  // (Authorization: token <key>:<secret>), both optional for the same
  // boot-without-crashing reason as the other integrations' credentials.
  FRAPPE_BASE_URL: z.string().optional(),
  FRAPPE_API_KEY: z.string().optional(),
  FRAPPE_API_SECRET: z.string().optional(),
});

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
