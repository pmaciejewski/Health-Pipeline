import { createHash, timingSafeEqual } from "node:crypto";

export function getExpectedToken() {
  return process.env.AUTH_TOKEN;
}

export function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}
