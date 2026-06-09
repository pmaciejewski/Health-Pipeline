import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createHash, timingSafeEqual } from "node:crypto";

let cachedToken;

export async function getExpectedToken(
  client = new SecretsManagerClient({}),
  secretArn = process.env.AUTH_SECRET_ARN
) {
  if (cachedToken) return cachedToken;
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  cachedToken = res.SecretString;
  return cachedToken;
}

export function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}
