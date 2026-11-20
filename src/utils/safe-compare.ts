import { createHash, timingSafeEqual } from "crypto";

// Compares a secret someone sent with the real one in constant time, so the
// response time can't be used to guess the secret one character at a time.
// Both sides are hashed first, so different lengths are safe to compare.
export function secretsMatch(provided: string | undefined | null, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
