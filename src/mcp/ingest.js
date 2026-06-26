import { PutObjectCommand } from "@aws-sdk/client-s3";
import { tokensMatch } from "./auth.js";

// Cap the directly-POSTed body well under the Lambda synchronous payload limit
// (~6 MB). A normal day-aggregated Health Auto Export is a few KB; anything
// approaching this is a full-history backfill, which should use the pre-signed
// /upload-url flow (straight to S3, no Lambda size ceiling).
export const MAX_INGEST_BYTES = 5 * 1024 * 1024;

export function getIngestToken() {
  return process.env.INGEST_TOKEN;
}

// API Gateway v2 lowercases header names, but read case-insensitively so the
// handler is robust to how a client (or a test) supplies them.
export function readHeader(event, name) {
  const headers = event?.headers ?? {};
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

// Handle POST /ingest: authenticate via the X-Auth-Token header, then write the
// request body to S3 as a fresh export object. The existing S3 ObjectCreated
// notification fans out to the parser, exactly as the pre-signed upload does.
// Returns { status, body } — index.js maps it onto an HTTP response.
//
// Auth failure returns 404 (not 401) so the route is indistinguishable from a
// nonexistent one to anyone probing without the token, matching the MCP route.
export async function ingestUpload(event, ctx) {
  const token = readHeader(event, "x-auth-token");
  if (!tokensMatch(token, getIngestToken()))
    return { status: 404, body: { message: "Not found" } };

  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64")
    : Buffer.from(event?.body ?? "", "utf8");

  if (raw.byteLength === 0)
    return { status: 400, body: { message: "Empty body" } };

  if (raw.byteLength > MAX_INGEST_BYTES)
    return {
      status: 413,
      body: {
        message:
          "Payload too large for direct ingest; use the pre-signed /upload-url flow for large backfills",
      },
    };

  const text = raw.toString("utf8");
  try {
    JSON.parse(text);
  } catch {
    return { status: 400, body: { message: "Body is not valid JSON" } };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `uploads/export-${stamp}.json`;
  await ctx.s3.send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: key,
      Body: text,
      ContentType: "application/json",
    })
  );

  return { status: 202, body: { status: "accepted", key } };
}
