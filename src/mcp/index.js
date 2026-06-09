import { S3Client } from "@aws-sdk/client-s3";
import { createDocumentClient } from "../shared/dynamo.js";
import { getExpectedToken, extractBearerToken, tokensMatch } from "./auth.js";
import { createMcpHandler } from "./mcp-handler.js";
import { getHealthData } from "./tools/get-health-data.js";
import { requestUploadUrl, createUploadUrl } from "./tools/request-upload-url.js";
import { getSyncStatus } from "./tools/get-sync-status.js";
import { buildMetadata, handleRegister, handleAuthorize, handleToken } from "./oauth.js";

const ctx = {
  ddb: createDocumentClient(),
  s3: new S3Client({}),
  tableName: process.env.TABLE_NAME,
  bucket: process.env.UPLOAD_BUCKET,
};

const handleMcp = createMcpHandler([getHealthData, requestUploadUrl, getSyncStatus]);

function resp(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body == null ? "" : JSON.stringify(body),
  };
}

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event.body ?? "";
  const ct = (event.headers?.["content-type"] ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function handler(event) {
  const method = (event.requestContext?.http?.method ?? "GET").toUpperCase();
  const path = event.rawPath ?? "";
  const baseUrl = `https://${event.requestContext.domainName}`;

  // ── OAuth discovery ──────────────────────────────────────────────────────
  if (path === "/.well-known/oauth-authorization-server" && method === "GET")
    return resp(200, buildMetadata(baseUrl));

  if (path === "/oauth/register" && method === "POST")
    return resp(201, handleRegister(parseBody(event)));

  if (path === "/oauth/authorize" && method === "GET") {
    const result = handleAuthorize(event.queryStringParameters ?? {});
    if (result.type === "redirect")
      return { statusCode: 302, headers: { Location: result.location }, body: "" };
    return resp(result.status, result.body);
  }

  if (path === "/oauth/token" && method === "POST") {
    const result = handleToken(parseBody(event), getExpectedToken());
    return resp(result.status, result.body);
  }

  // ── Protected routes (Bearer token required) ─────────────────────────────
  const bearerToken = extractBearerToken(event);
  if (!tokensMatch(bearerToken, getExpectedToken())) {
    return resp(401, { error: "unauthorized" }, {
      "WWW-Authenticate": `Bearer realm="${baseUrl}/oauth/authorize"`,
    });
  }

  if (path === "/upload-url" && method === "GET")
    return resp(200, await createUploadUrl(ctx));

  if (path === "/mcp") {
    if (method !== "POST")
      return resp(405, { message: "Method not allowed; POST JSON-RPC messages" });
    let msg;
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : event.body ?? "";
      msg = JSON.parse(raw);
    } catch {
      return resp(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const out = await handleMcp(msg, ctx);
    return resp(out.status, out.body);
  }

  return resp(404, { message: "Not found" });
}
