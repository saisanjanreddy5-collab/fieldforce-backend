import { env } from "./env";

export function isWhatsappConfigured(): boolean {
  return Boolean(env.WHATSAPP_API_KEY && env.WHATSAPP_WANUMBER && env.WHATSAPP_PHONE_NUMBER_ID);
}

// K3 moved us off the old v2 URL (which took the WABA number only as a
// header) onto this v3 one, which also puts the phone number id in the
// path. Everything else in their documentation - the "api key"/"wanumber"
// headers, the request/response body shapes - is still the v2 doc, since
// nothing said those changed too; this is a best-effort read of their
// migration notice, not a confirmed v3 spec.
export const WHATSAPP_BASE_URL = "https://partnersv1.pinbot.ai/v3";

// Media download is a different API family from sending messages (no
// phone_number_id in the path anywhere in K3's own docs for it), and their
// migration notice was specifically about the /messages endpoint - nothing
// said this one moved too. Same "best-effort read of their docs, not a
// confirmed spec" caveat as WHATSAPP_BASE_URL above.
export const WHATSAPP_MEDIA_BASE_URL = "https://partners.pinbot.ai/v2";
