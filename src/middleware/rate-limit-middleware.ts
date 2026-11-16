import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Password guessing against one account - keyed on network + email, so one
// person mistyping their own password can't lock out everyone else sharing
// the same office/carrier IP (a whole call-center floor usually does).
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}|${email}`;
  },
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
});

// Credential stuffing (many different emails from one source) - a much
// higher per-network ceiling, still far below anything a script would need.
export const loginIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
});

// /auth/refresh and /auth/logout already require a valid signed refresh
// token, so they're not a password-guessing surface - but every logged-in
// user calls /refresh roughly every 15 minutes (the access-token lifetime),
// so sharing the login limiter's tiny budget would start logging real
// users out the moment ~10 people on one network were active at once.
export const sessionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

// Deliberately its own, much higher-volume limiter than loginRateLimiter
// above: /sso/token and /sso/userinfo are called by Frappe's own server, on
// behalf of every employee's and customer's login company-wide, all from
// Frappe's one source IP - sharing the 10-per-15-min login-brute-force
// limiter would start rejecting real logins the moment more than 10 people
// signed in within the same 15 minutes.
export const ssoRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

// This is fetched by K3's own servers (every outbound attachment we send)
// as well as by our own frontend (every inbound/outbound attachment shown
// in a chat thread) - public and unauthenticated like the QR routes below,
// for the same reason (K3 has no Authorization header to send), but with a
// much higher ceiling since a single busy WhatsApp thread can load many
// media files on one page view.
export const whatsappMediaRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

// QR capture pages are public and unauthenticated by design - these are the
// only real abuse guard on them. Scans can legitimately burst (a busy expo
// booth), submissions can't.
export const qrScanRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

export const qrSubmitRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many submissions. Please try again later." },
});
