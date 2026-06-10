import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { extractRecords } from "../src/parser/xml-stream.js";
import { Aggregator } from "../src/parser/aggregator.js";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/export-sample.xml", import.meta.url)),
  "utf8"
);

test("extracts Record and CategorySample nodes from the stream", async () => {
  const records = [];
  await extractRecords(Readable.from([fixture]), (r) => records.push(r));
  // 12 quantity Records (incl. step count + malformed + 3 new body metrics)
  // + 7 CategorySamples
  assert.equal(records.length, 19);
  assert.ok(records.every((r) => typeof r.type === "string"));
});

test("fixture aggregates into expected daily rows end to end", async () => {
  const agg = new Aggregator();
  await extractRecords(Readable.from([fixture]), (r) => agg.addRecord(r));
  const rows = agg.finalize();

  assert.equal(rows.length, 2);
  const [d8, d9] = rows;

  assert.equal(d8.date, "2026-06-08");
  assert.equal(d8.hrv_ms, 42.1);
  assert.equal(d8.resting_hr_bpm, 54);
  assert.equal(d8.body_mass_kg, 82.4);
  assert.equal(d8.body_fat_pct, 18.5);
  assert.equal(d8.bmi, 24.7);
  assert.equal(d8.lean_body_mass_kg, 67.2);
  // Overnight: core 120+152, deep 48, rem 117, awake 13; nap unspecified 40.
  assert.equal(d8.core_sleep_min, 272);
  assert.equal(d8.deep_sleep_min, 48);
  assert.equal(d8.rem_sleep_min, 117);
  assert.equal(d8.awake_min, 13);
  assert.equal(d8.total_sleep_min, 272 + 48 + 117 + 40);
  assert.equal(d8.sleep_sessions, 2);

  assert.equal(d9.date, "2026-06-09");
  assert.equal(d9.hrv_ms, 48.2);
  assert.equal(d9.total_sleep_min, null);
  assert.equal(d9.body_fat_pct, null);

  // Malformed body-mass record skipped, step count + unknown types ignored.
  assert.equal(agg.recordsSkipped, 1);
});

test("streaming works chunk by chunk (records split across chunks)", async () => {
  const chunks = [];
  for (let i = 0; i < fixture.length; i += 97) chunks.push(fixture.slice(i, i + 97));
  const records = [];
  await extractRecords(Readable.from(chunks), (r) => records.push(r));
  assert.equal(records.length, 19);
});
