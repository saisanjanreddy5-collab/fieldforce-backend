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
