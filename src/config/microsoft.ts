import { env } from "./env";

// Delegated scopes only - every action happens as the connected salesperson
// themselves, never as a shared system identity.
export const MS_SCOPES = ["Mail.Send", "Calendars.ReadWrite", "User.Read", "offline_access"];

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
