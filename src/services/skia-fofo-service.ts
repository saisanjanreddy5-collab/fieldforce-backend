import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

export function isSkiaFofoConfigured(): boolean {
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

// Every call here originates from this CRM pushing an already-approved FOFO
// handoff, never from the store app itself - so is_from_cmr is always true,
// not a per-call choice.
export async function registerFofoUser(input: RegisterFofoUserInput): Promise<RegisterFofoUserResult> {
  if (!isSkiaFofoConfigured()) {
    throw new ApiError(503, "SKIA FOFO integration is not configured yet - set SKIA_FOFO_CMR_TOKEN");
  }

  const response = await fetch(env.SKIA_FOFO_REGISTRATION_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: input.userName,
      store_app_use_phone_number: input.phoneNumber,
      is_from_cmr: true,
      cmr_token: env.SKIA_FOFO_CMR_TOKEN,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { message?: string } | null)?.message ?? response.statusText;
    if (isAlreadyRegisteredMessage(message)) {
      return { alreadyRegistered: true };
    }
    throw new ApiError(502, `SKIA FOFO user registration failed: ${message}`);
  }
  return { alreadyRegistered: false };
}
