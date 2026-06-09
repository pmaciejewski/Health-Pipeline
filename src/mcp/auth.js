import { createHash, timingSafeEqual } from "node:crypto";

export function getExpectedToken() {
  return process.env.AUTH_TOKEN;
}

export function extractBearerToken(event) {
  const auth =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}
