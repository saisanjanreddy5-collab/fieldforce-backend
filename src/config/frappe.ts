import { env } from "./env";

export function isFrappeConfigured(): boolean {
  return Boolean(env.FRAPPE_BASE_URL && env.FRAPPE_API_KEY && env.FRAPPE_API_SECRET);
}
