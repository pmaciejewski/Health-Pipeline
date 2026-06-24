import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ingestUpload, readHeader, MAX_INGEST_BYTES } from "../src/mcp/ingest.js";

function fakeS3() {
  return {
    puts: [],
    async send(cmd) {
      this.puts.push(cmd.input);
      return {};
    },
  };
}

const ctx = () => ({ s3: fakeS3(), bucket: "b" });
const body = JSON.stringify({ data: { metrics: [] } });

let prev;
beforeEach(() => {
  prev = process.env.INGEST_TOKEN;
  process.env.INGEST_TOKEN = "secret-token";
});
afterEach(() => {
  if (prev === undefined) delete process.env.INGEST_TOKEN;
  else process.env.INGEST_TOKEN = prev;
});

test("readHeader is case-insensitive", () => {
  const ev = { headers: { "X-Auth-Token": "v" } };
  assert.equal(readHeader(ev, "x-auth-token"), "v");
  assert.equal(readHeader(ev, "X-AUTH-TOKEN"), "v");
  assert.equal(readHeader({ headers: {} }, "x-auth-token"), undefined);
});

test("valid token + JSON writes to S3 under uploads/ and returns 202", async () => {
  const c = ctx();
  const out = await ingestUpload(
    { headers: { "x-auth-token": "secret-token" }, body },
    c
  );
  assert.equal(out.status, 202);
  assert.equal(out.body.status, "accepted");
  assert.equal(c.s3.puts.length, 1);
  const put = c.s3.puts[0];
  assert.equal(put.Bucket, "b");
  assert.match(put.Key, /^uploads\/export-.*\.json$/);
  assert.equal(put.Body, body);
  assert.equal(put.ContentType, "application/json");
  assert.equal(out.body.key, put.Key);
});

test("base64-encoded body is decoded before storing", async () => {
  const c = ctx();
  const out = await ingestUpload(
    {
      headers: { "x-auth-token": "secret-token" },
      body: Buffer.from(body, "utf8").toString("base64"),
      isBase64Encoded: true,
    },
    c
  );
  assert.equal(out.status, 202);
  assert.equal(c.s3.puts[0].Body, body);
});

test("wrong token returns 404 and writes nothing", async () => {
  const c = ctx();
  const out = await ingestUpload(
    { headers: { "x-auth-token": "nope" }, body },
    c
  );
  assert.equal(out.status, 404);
  assert.equal(out.body.message, "Not found");
  assert.equal(c.s3.puts.length, 0);
});

test("missing token returns 404", async () => {
  const c = ctx();
  const out = await ingestUpload({ headers: {}, body }, c);
  assert.equal(out.status, 404);
  assert.equal(c.s3.puts.length, 0);
});

test("empty body returns 400", async () => {
  const c = ctx();
  const out = await ingestUpload(
    { headers: { "x-auth-token": "secret-token" }, body: "" },
    c
  );
  assert.equal(out.status, 400);
  assert.equal(c.s3.puts.length, 0);
});

test("invalid JSON returns 400 and is not stored", async () => {
  const c = ctx();
  const out = await ingestUpload(
    { headers: { "x-auth-token": "secret-token" }, body: "{not json" },
    c
  );
  assert.equal(out.status, 400);
  assert.match(out.body.message, /not valid JSON/);
  assert.equal(c.s3.puts.length, 0);
});

test("oversized body returns 413 and is not stored", async () => {
  const c = ctx();
  const big = "x".repeat(MAX_INGEST_BYTES + 1);
  const out = await ingestUpload(
    { headers: { "x-auth-token": "secret-token" }, body: big },
    c
  );
  assert.equal(out.status, 413);
  assert.equal(c.s3.puts.length, 0);
});
