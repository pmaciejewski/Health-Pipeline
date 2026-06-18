import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bodyToString, readJson } from "../src/parser/index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/health-auto-export-sample.json", import.meta.url)
);

// Mimic the AWS SDK v3 stream blob, whose canonical reader is transformToString.
function sdkBody(buf) {
  return { transformToString: async () => buf.toString("utf8") };
}

test("bodyToString reads an AWS SDK stream blob via transformToString", async () => {
  const out = await bodyToString(sdkBody(Buffer.from('{"ok":true}')));
  assert.equal(out, '{"ok":true}');
});

test("bodyToString reads a Node readable of Buffer chunks", async () => {
  const body = Readable.from([Buffer.from("{\"a\":"), Buffer.from("1}")]);
  assert.equal(await bodyToString(body), '{"a":1}');
});

test("bodyToString decodes multi-byte chars split across chunk boundaries", async () => {
  // "Paweł" UTF-8 bytes; split mid-character (ł = 0xC5 0x82).
  const full = Buffer.from("Paweł", "utf8");
  const cut = full.length - 1;
  const body = Readable.from([full.subarray(0, cut), full.subarray(cut)]);
  assert.equal(await bodyToString(body), "Paweł");
});

test("bodyToString handles string and Buffer inputs directly", async () => {
  assert.equal(await bodyToString("hi"), "hi");
  assert.equal(await bodyToString(Buffer.from("hi")), "hi");
  assert.equal(await bodyToString(null), "");
});

test("readJson throws a clear error on an empty body", async () => {
  await assert.rejects(
    () => readJson(Readable.from([]), "uploads/x.json"),
    /Empty object at uploads\/x\.json/
  );
});

test("readJson wraps malformed JSON with the key", async () => {
  await assert.rejects(
    () => readJson(sdkBody(Buffer.from("{not json")), "uploads/x.json"),
    /Failed to parse JSON from uploads\/x\.json/
  );
});

test("readJson parses the real sample feed from an SDK-style body", async () => {
  const buf = readFileSync(fixturePath);
  const json = await readJson(sdkBody(buf), "uploads/export.json");
  assert.equal(json.data.metrics.length > 0, true);
});

test("readJson parses the real sample feed streamed in tiny chunks", async () => {
  const buf = readFileSync(fixturePath);
  const chunks = [];
  for (let i = 0; i < buf.length; i += 64) chunks.push(buf.subarray(i, i + 64));
  const json = await readJson(Readable.from(chunks), "uploads/export.json");
  assert.equal(json.data.metrics.length > 0, true);
});
