import { test } from "node:test";
import assert from "node:assert/strict";
import { getHealthData } from "../src/mcp/tools/get-health-data.js";
import { getRawHealthData } from "../src/mcp/tools/get-raw-health-data.js";
import { tokensMatch } from "../src/mcp/auth.js";
import { createMcpHandler } from "../src/mcp/mcp-handler.js";

function fakeDdb(items = []) {
  return {
    calls: [],
    async send(cmd) {
      this.calls.push(cmd.input);
      return { Items: items };
    },
  };
}

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
    () =>
      getHealthData.handler(
        { start_date: "2024-01-01", end_date: "2026-06-09" },
        ctx
      ),
    /Range too large/
  );
  await assert.rejects(
    () =>
      getHealthData.handler(
        { start_date: "2026-06-09", end_date: "2026-06-01" },
        ctx
      ),
    /start_date must be/
  );
});

test("get_raw_health_data defaults to the last 7 days and strips dynamo keys", async () => {
  const ddb = fakeDdb([
    {
      pk: "RAW",
      sk: "2026-06-18#step_count",
      date: "2026-06-18",
      metric: "step_count",
      units: "count",
      points: [{ qty: 5 }],
      updated_at: "x",
    },
  ]);
  const res = await getRawHealthData.handler({}, { ddb, tableName: "t" });
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(res.end_date, today);
  const rangeDays =
    (Date.parse(res.end_date) - Date.parse(res.start_date)) / 86400000 + 1;
  assert.equal(rangeDays, 7);
  assert.equal(res.items_returned, 1);
  assert.deepEqual(res.raw[0], {
    date: "2026-06-18",
    metric: "step_count",
    units: "count",
    points: [{ qty: 5 }],
  });
});

test("get_raw_health_data passes a metric filter through to the query", async () => {
  const ddb = fakeDdb([]);
  const res = await getRawHealthData.handler(
    { last_days: 3, metric: "heart_rate" },
    { ddb, tableName: "t" }
  );
  assert.equal(res.metric, "heart_rate");
  const input = ddb.calls[0];
  assert.equal(input.ExpressionAttributeValues[":p"], "RAW");
  assert.equal(input.ExpressionAttributeValues[":m"], "heart_rate");
  assert.equal(input.FilterExpression, "#m = :m");
  assert.deepEqual(input.ExpressionAttributeNames, { "#m": "metric" });
});

test("get_raw_health_data rejects ranges beyond its 31-day cap", async () => {
  const ctx = { ddb: fakeDdb(), tableName: "t" };
  await assert.rejects(
    () =>
      getRawHealthData.handler(
        { start_date: "2026-01-01", end_date: "2026-06-09" },
        ctx
      ),
    /Range too large/
  );
});

test("tokensMatch compares correctly and rejects empties", () => {
  assert.equal(tokensMatch("abc", "abc"), true);
  assert.equal(tokensMatch("abc", "abd"), false);
  assert.equal(tokensMatch("", "abc"), false);
  assert.equal(tokensMatch(undefined, "abc"), false);
  assert.equal(tokensMatch("abc", undefined), false);
});

test("MCP handler: initialize negotiates a supported protocol version", async () => {
  const handle = createMcpHandler([]);
  const out = await handle(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    },
    {}
  );
  assert.equal(out.status, 200);
  assert.equal(out.body.result.protocolVersion, "2025-03-26");
  assert.equal(out.body.result.serverInfo.name, "health-pipeline");
});

test("MCP handler: unknown requested version falls back to latest", async () => {
  const handle = createMcpHandler([]);
  const out = await handle(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    },
    {}
  );
  assert.equal(out.body.result.protocolVersion, "2025-06-18");
});

test("MCP handler: notifications return 202 with no body", async () => {
  const handle = createMcpHandler([]);
  const out = await handle(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {}
  );
  assert.equal(out.status, 202);
  assert.equal(out.body, null);
});

test("MCP handler: tools/list returns tool schemas", async () => {
  const tool = {
    name: "demo",
    description: "d",
    inputSchema: { type: "object" },
    handler: async () => ({ ok: true }),
  };
  const handle = createMcpHandler([tool]);
  const out = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {});
  assert.deepEqual(out.body.result.tools, [
    { name: "demo", description: "d", inputSchema: { type: "object" } },
  ]);
});

test("MCP handler: tools/call success and tool error paths", async () => {
  const tool = {
    name: "demo",
    description: "d",
    inputSchema: { type: "object" },
    handler: async (args) => {
      if (args.boom) throw new Error("boom");
      return { ok: true };
    },
  };
  const handle = createMcpHandler([tool]);

  const ok = await handle(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo", arguments: {} } },
    {}
  );
  assert.equal(ok.body.result.isError, undefined);
  assert.match(ok.body.result.content[0].text, /"ok": true/);

  const err = await handle(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "demo", arguments: { boom: true } },
    },
    {}
  );
  assert.equal(err.body.result.isError, true);
  assert.match(err.body.result.content[0].text, /boom/);

  const missing = await handle(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } },
    {}
  );
  assert.equal(missing.body.error.code, -32602);
});

test("MCP handler: rejects batches and unknown methods", async () => {
  const handle = createMcpHandler([]);
  const batch = await handle([{ jsonrpc: "2.0", id: 1, method: "ping" }], {});
  assert.equal(batch.body.error.code, -32600);

  const unknown = await handle(
    { jsonrpc: "2.0", id: 9, method: "resources/list" },
    {}
  );
  assert.equal(unknown.body.error.code, -32601);
});
