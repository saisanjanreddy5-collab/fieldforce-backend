import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

export function isSkiaFofoConfigured(): boolean {
  return Boolean(env.SKIA_FOFO_REGISTRATION_URL && env.SKIA_FOFO_CMR_TOKEN);
}

interface RegisterFofoUserInput {
  userName: string;
  phoneNumber: string;
}

// Every call here originates from this CRM pushing an already-approved FOFO
// handoff, never from the store app itself - so is_from_cmr is always true,
// not a per-call choice.
export async function registerFofoUser(input: RegisterFofoUserInput): Promise<void> {
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
    const message = (data as { message?: string } | null)?.message;
    throw new ApiError(502, `SKIA FOFO user registration failed: ${message ?? response.statusText}`);
  }
}
