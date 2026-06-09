import { test } from "node:test";
import assert from "node:assert/strict";
import { getHealthData } from "../src/mcp/tools/get-health-data.js";
import { tokensMatch, extractBearerToken } from "../src/mcp/auth.js";
import { createMcpHandler } from "../src/mcp/mcp-handler.js";
import { buildMetadata, handleRegister, handleAuthorize, handleToken } from "../src/mcp/oauth.js";

function fakeDdb(items = []) {
  return {
    calls: [],
    async send(cmd) {
      this.calls.push(cmd.input);
      return { Items: items };
    },
  };
}

// ── get_health_data ──────────────────────────────────────────────────────────

test("get_health_data defaults to the last 30 days ending today", async () => {
  const ddb = fakeDdb([]);
  const res = await getHealthData.handler({}, { ddb, tableName: "t" });
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(res.end_date, today);
  const rangeDays =
    (Date.parse(res.end_date) - Date.parse(res.start_date)) / 86400000 + 1;
  assert.equal(rangeDays, 30);
});

test("get_health_data resolves last_days relative to end_date", async () => {
  const ddb = fakeDdb([]);
  const res = await getHealthData.handler(
    { end_date: "2026-06-09", last_days: 7 },
    { ddb, tableName: "t" }
  );
  assert.equal(res.start_date, "2026-06-03");
  assert.equal(res.end_date, "2026-06-09");
});

test("get_health_data strips dynamo keys and sorts rows", async () => {
  const ddb = fakeDdb([
    { pk: "DAY", sk: "2026-06-09", date: "2026-06-09", hrv_ms: 48, updated_at: "x" },
    { pk: "DAY", sk: "2026-06-08", date: "2026-06-08", hrv_ms: 42, updated_at: "x" },
  ]);
  const res = await getHealthData.handler(
    { start_date: "2026-06-08", end_date: "2026-06-09" },
    { ddb, tableName: "t" }
  );
  assert.equal(res.days_returned, 2);
  assert.deepEqual(res.days[0], { date: "2026-06-08", hrv_ms: 42 });
  assert.equal(res.days[1].date, "2026-06-09");
});

test("get_health_data rejects invalid dates and oversized ranges", async () => {
  const ctx = { ddb: fakeDdb(), tableName: "t" };
  await assert.rejects(
    () => getHealthData.handler({ start_date: "junk" }, ctx),
    /Invalid start_date/
  );
  await assert.rejects(
    () => getHealthData.handler({ start_date: "2024-01-01", end_date: "2026-06-09" }, ctx),
    /Range too large/
  );
  await assert.rejects(
    () => getHealthData.handler({ start_date: "2026-06-09", end_date: "2026-06-01" }, ctx),
    /start_date must be/
  );
});

// ── auth ─────────────────────────────────────────────────────────────────────

test("tokensMatch compares correctly and rejects empties", () => {
  assert.equal(tokensMatch("abc", "abc"), true);
  assert.equal(tokensMatch("abc", "abd"), false);
  assert.equal(tokensMatch("", "abc"), false);
  assert.equal(tokensMatch(undefined, "abc"), false);
  assert.equal(tokensMatch("abc", undefined), false);
});

test("extractBearerToken handles case-insensitive header names", () => {
  assert.equal(extractBearerToken({ headers: { authorization: "Bearer mytoken" } }), "mytoken");
  assert.equal(extractBearerToken({ headers: { Authorization: "Bearer mytoken" } }), "mytoken");
  assert.equal(extractBearerToken({ headers: {} }), null);
  assert.equal(extractBearerToken({ headers: { authorization: "Basic abc" } }), null);
});

// ── OAuth ─────────────────────────────────────────────────────────────────────

test("buildMetadata includes required OAuth endpoints", () => {
  const meta = buildMetadata("https://example.com");
  assert.equal(meta.issuer, "https://example.com");
  assert.ok(meta.authorization_endpoint.startsWith("https://example.com"));
  assert.ok(meta.token_endpoint.startsWith("https://example.com"));
  assert.ok(meta.registration_endpoint.startsWith("https://example.com"));
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
});

test("handleRegister accepts any request and returns a client_id", () => {
  const result = handleRegister({ redirect_uris: ["https://claude.ai/callback"] });
  assert.equal(typeof result.client_id, "string");
  assert.ok(result.client_id.length > 0);
  assert.deepEqual(result.grant_types, ["authorization_code"]);
});

test("handleAuthorize redirects with code = code_challenge", () => {
  const result = handleAuthorize({
    redirect_uri: "https://claude.ai/callback",
    state: "abc123",
    code_challenge: "challenge_value",
    code_challenge_method: "S256",
  });
  assert.equal(result.type, "redirect");
  const url = new URL(result.location);
  assert.equal(url.searchParams.get("code"), "challenge_value");
  assert.equal(url.searchParams.get("state"), "abc123");
});

test("handleAuthorize errors without redirect_uri", () => {
  const result = handleAuthorize({ code_challenge: "x" });
  assert.equal(result.type, "error");
  assert.equal(result.status, 400);
});

test("handleToken validates PKCE and returns the bearer token", async () => {
  const { createHash } = await import("node:crypto");
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const result = handleToken(
    { grant_type: "authorization_code", code: challenge, code_verifier: verifier },
    "my-secret-token"
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.access_token, "my-secret-token");
  assert.equal(result.body.token_type, "bearer");
});

test("handleToken rejects wrong code_verifier", async () => {
  const { createHash } = await import("node:crypto");
  const verifier = "correct_verifier";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const result = handleToken(
    { grant_type: "authorization_code", code: challenge, code_verifier: "wrong_verifier" },
    "token"
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_grant");
});

test("handleToken rejects unsupported grant type", () => {
  const result = handleToken({ grant_type: "client_credentials" }, "token");
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "unsupported_grant_type");
});

// ── MCP handler ───────────────────────────────────────────────────────────────

test("MCP handler: initialize negotiates a supported protocol version", async () => {
  const handle = createMcpHandler([]);
  const out = await handle(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    {}
  );
  assert.equal(out.status, 200);
  assert.equal(out.body.result.protocolVersion, "2025-03-26");
  assert.equal(out.body.result.serverInfo.name, "health-pipeline");
});

test("MCP handler: unknown requested version falls back to latest", async () => {
  const handle = createMcpHandler([]);
  const out = await handle(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    {}
  );
  assert.equal(out.body.result.protocolVersion, "2025-06-18");
});

test("MCP handler: notifications return 202 with no body", async () => {
  const handle = createMcpHandler([]);
  const out = await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, {});
  assert.equal(out.status, 202);
  assert.equal(out.body, null);
});

test("MCP handler: tools/list returns tool schemas", async () => {
  const tool = { name: "demo", description: "d", inputSchema: { type: "object" }, handler: async () => ({ ok: true }) };
  const handle = createMcpHandler([tool]);
  const out = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {});
  assert.deepEqual(out.body.result.tools, [
    { name: "demo", description: "d", inputSchema: { type: "object" } },
  ]);
});

test("MCP handler: tools/call success and error paths", async () => {
  const tool = {
    name: "demo", description: "d", inputSchema: { type: "object" },
    handler: async (args) => { if (args.boom) throw new Error("boom"); return { ok: true }; },
  };
  const handle = createMcpHandler([tool]);

  const ok = await handle(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo", arguments: {} } }, {}
  );
  assert.equal(ok.body.result.isError, undefined);
  assert.match(ok.body.result.content[0].text, /"ok": true/);

  const err = await handle(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "demo", arguments: { boom: true } } }, {}
  );
  assert.equal(err.body.result.isError, true);
  assert.match(err.body.result.content[0].text, /boom/);

  const missing = await handle(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }, {}
  );
  assert.equal(missing.body.error.code, -32602);
});

test("MCP handler: rejects batches and unknown methods", async () => {
  const handle = createMcpHandler([]);
  const batch = await handle([{ jsonrpc: "2.0", id: 1, method: "ping" }], {});
  assert.equal(batch.body.error.code, -32600);

  const unknown = await handle({ jsonrpc: "2.0", id: 9, method: "resources/list" }, {});
  assert.equal(unknown.body.error.code, -32601);
});
