import rateLimit from "express-rate-limit";

// Protects login/refresh from brute-force and credential-stuffing attempts.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
});

// Deliberately its own, much higher-volume limiter than authRateLimiter
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
