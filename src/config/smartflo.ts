import { env } from "./env";

export function isSmartfloConfigured(): boolean {
  return Boolean(env.SMARTFLO_API_TOKEN);
}

export const SMARTFLO_BASE_URL = "https://api-smartflo.tatateleservices.com/v1";
