import { env } from "../config/env";
import { externalFetch } from "../utils/external-fetch";
import { ApiError } from "../utils/api-error";

function isSkiaFofoConfigured(): boolean {
  return Boolean(env.SKIA_FOFO_REGISTRATION_URL && env.SKIA_FOFO_CMR_TOKEN);
}

interface RegisterFofoUserInput {
  userName: string;
  phoneNumber: string;
}

export interface RegisterFofoUserResult {
  // True when SKIA rejected this specifically because the phone already has
  // a FOFO app account - expected and fine (see pushToOnboardingApp's own
  // comment: one person legitimately owns multiple franchises, one SKIA
  // account per phone, not per store), not a real failure.
  alreadyRegistered: boolean;
}

// Pulled out as its own pure function so it's directly unit-testable without
// a real network call - SKIA FOFO is a live, genuinely configured
// integration in every environment this runs in (see testFofoRepushGuard.ts's
// own comment), so a test exercising this logic end to end would place a
// real external request. Heuristic match on SKIA's own wording, not a
// documented error code - there's no contract from their side distinguishing
// "already registered" from any other rejection, so this may need
// tightening if their phrasing ever changes. Confirmed real-world case:
// pushing a second franchise for a phone number already registered on SKIA
// FOFO from a prior push.
export function isAlreadyRegisteredMessage(message: string): boolean {
  return /already\s*(exists|registered)/i.test(message);
}

// SKIA's answer when the CMR token isn't accepted on that SKIA system:
// HTTP 401/403, or a message like "Invalid CMR token".
function isTokenRejection(status: number, message: string): boolean {
  return status === 401 || status === 403 || /(invalid|expired|wrong).{0,20}token|token.{0,20}(invalid|expired)/i.test(message);
}

// Every call here originates from this CRM pushing an already-approved FOFO
// handoff, never from the store app itself - so is_from_cmr is always true,
// not a per-call choice.
export async function registerFofoUser(input: RegisterFofoUserInput): Promise<RegisterFofoUserResult> {
  if (!isSkiaFofoConfigured()) {
    throw new ApiError(503, "SKIA FOFO integration is not configured yet - set SKIA_FOFO_CMR_TOKEN");
  }

  const response = await externalFetch(env.SKIA_FOFO_REGISTRATION_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: input.userName,
      store_app_use_phone_number: input.phoneNumber,
      is_from_cmr: true,
      // Trimmed: a stray space or Windows line ending pasted into .env is
      // invisible but makes SKIA reject the token as invalid.
      cmr_token: env.SKIA_FOFO_CMR_TOKEN?.trim(),
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { message?: string } | null)?.message ?? response.statusText;
    if (isAlreadyRegisteredMessage(message)) {
      return { alreadyRegistered: true };
    }
    // Name the server that answered - "Invalid CMR token" almost always
    // means the token belongs to a different SKIA environment (e.g. a live
    // token sent to SKIA's test server because SKIA_FOFO_REGISTRATION_URL
    // isn't set in .env and fell back to the test default).
    let server = "SKIA";
    try {
      server = new URL(env.SKIA_FOFO_REGISTRATION_URL!).host;
    } catch {
      // keep the generic name
    }
    // SKIA refusing our CMR token is a setup problem on their side for this
    // server (e.g. their test system's token was reset) - say so in plain
    // words, so it isn't read as a CRM bug. Nothing was saved: the lead is
    // only marked pushed after SKIA accepts (see pushToOnboardingAppOnce).
    if (isTokenRejection(response.status, message)) {
      throw new ApiError(
        502,
        `Not pushed - SKIA's onboarding system (${server}) refused FieldForce's access token ("${message}"). Nothing was saved on this lead. The SKIA team needs to issue a valid token for this server; then push again.`
      );
    }
    throw new ApiError(502, `Not pushed - SKIA's onboarding system (${server}) rejected the registration: ${message}. Nothing was saved on this lead.`);
  }
  return { alreadyRegistered: false };
}
