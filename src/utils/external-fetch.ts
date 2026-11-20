import { ApiError } from "./api-error";

// Every call this backend makes to an outside service (WhatsApp/K3,
// Smartflo, Microsoft Graph, SKIA's onboarding app) goes through here.
// Plain fetch() has no time limit of its own - a provider that accepts the
// connection and then stalls would hold the user's request (and, for lead
// creation's welcome message, the whole save) open for minutes. This caps
// every such call and turns a stall into a clear, normal error instead.
const DEFAULT_TIMEOUT_MS = 20_000;

export async function externalFetch(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ApiError(504, "An external service took too long to respond - please try again");
    }
    throw error;
  }
}

// Media files (WhatsApp attachments) can be several MB - a longer, but
// still finite, window.
export const MEDIA_TIMEOUT_MS = 60_000;
