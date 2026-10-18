import { env } from "./env";

// Delegated scopes only - every action happens as the connected salesperson
// themselves, never as a shared system identity. Mail.Read is what lets the
// inbox-sync job (microsoft-mail-sync-service.ts) see a lead's reply at all -
// Mail.Send alone only ever allowed sending, never reading. Already-connected
// accounts don't retroactively gain this: each person needs to reconnect
// from their profile once this ships, so their token actually carries it.
export const MS_SCOPES = ["Mail.Send", "Mail.Read", "Calendars.ReadWrite", "User.Read", "offline_access"];

export function isMicrosoftConfigured(): boolean {
  return Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
}

export function msAuthorizeUrl(): string {
  return `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/authorize`;
}

export function msTokenUrl(): string {
  return `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`;
}

export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
