import { S3Client } from "@aws-sdk/client-s3";
import { createDocumentClient } from "../shared/dynamo.js";
import { getExpectedToken, tokensMatch } from "./auth.js";
import { createMcpHandler } from "./mcp-handler.js";
import { getHealthData } from "./tools/get-health-data.js";
import { requestUploadUrl, createUploadUrl } from "./tools/request-upload-url.js";
import { getSyncStatus } from "./tools/get-sync-status.js";
import { ingestUpload } from "./ingest.js";

const ctx = {
  ddb: createDocumentClient(),
  s3: new S3Client({}),
  tableName: process.env.TABLE_NAME,
  bucket: process.env.UPLOAD_BUCKET,
};

const handleMcp = createMcpHandler([getHealthData, requestUploadUrl, getSyncStatus]);

const JSON_HEADERS = { "Content-Type": "application/json" };

function resp(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: body == null ? "" : JSON.stringify(body),
  };
}

// Auth failures return 404 (not 401) so the endpoint is indistinguishable
// from a nonexistent route to anyone probing without the token.
const NOT_FOUND = resp(404, { message: "Not found" });

export async function handler(event) {
  // Direct ingest authenticates via header, not a path token, so it is handled
  // before the path-token gate below.
  if (event.routeKey === "POST /ingest") {
    const out = await ingestUpload(event, ctx);
    return resp(out.status, out.body);
  }

  const token = event.pathParameters?.token;
  if (!tokensMatch(token, getExpectedToken())) return NOT_FOUND;

  if (event.routeKey === "GET /upload-url/{token}") {
    return resp(200, await createUploadUrl(ctx));
  }

  if (event.routeKey === "ANY /mcp/{token}") {
    const method = event.requestContext?.http?.method;
    if (method !== "POST") {
      // Stateless server: no SSE stream (GET) or session teardown (DELETE).
      return resp(405, { message: "Method not allowed; POST JSON-RPC messages" });
    }

    let msg;
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : event.body ?? "";
      msg = JSON.parse(raw);
    } catch {
      return resp(400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }

    const out = await handleMcp(msg, ctx);
    return resp(out.status, out.body);
  }

  return NOT_FOUND;
}
