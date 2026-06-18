import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  JsonAggregator,
  parseJsonExport,
  parseAppleDate,
} from "../src/parser/json-metrics.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/health-auto-export-sample.json", import.meta.url)),
    "utf8"
  )
);

function metric(name, data, units = "count") {
  return { name, units, data };
}

test("parseAppleDate extracts epoch and local calendar date", () => {
  const t = parseAppleDate("2026-06-08 23:14:00 +0100");
  assert.equal(t.localDate, "2026-06-08");
  assert.equal(t.epoch, Date.UTC(2026, 5, 8, 22, 14, 0));
});

test("parseAppleDate handles negative offsets", () => {
  const t = parseAppleDate("2026-06-08 23:14:00 -0500");
  assert.equal(t.localDate, "2026-06-08");
  assert.equal(t.epoch, Date.UTC(2026, 5, 9, 4, 14, 0));
});

test("parseAppleDate rejects garbage", () => {
  assert.equal(parseAppleDate("not-a-date"), null);
  assert.equal(parseAppleDate(undefined), null);
});

test("quantity metric maps to the mapped field on its local day", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("step_count", [
      { date: "2026-06-11 00:00:00 +0200", qty: 14420, source: "Watch" },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.date, "2026-06-11");
  assert.equal(row.step_count, 14420);
});

test("body fat / BMI / HRV are rounded to 2 decimals", () => {
  const agg = new JsonAggregator();
  agg.addMetric(metric("body_fat_percentage", [{ date: "2026-06-15 00:00:00 +0200", qty: 17.935001373291016 }]));
  agg.addMetric(metric("body_mass_index", [{ date: "2026-06-15 00:00:00 +0200", qty: 24.996377944946289 }]));
  agg.addMetric(metric("heart_rate_variability", [{ date: "2026-06-15 00:00:00 +0200", qty: 44.622312885750034 }]));
  const [row] = agg.finalize();
  assert.equal(row.body_fat_pct, 17.94);
  assert.equal(row.bmi, 25.0);
  assert.equal(row.hrv_ms, 44.62);
});

test("heart_rate keeps min/max/avg as separate rounded fields", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("heart_rate", [
      { date: "2026-06-11 00:00:00 +0200", Min: 57, Max: 137, Avg: 86.888992755240352 },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.heart_rate_min_bpm, 57);
  assert.equal(row.heart_rate_max_bpm, 137);
  assert.equal(row.heart_rate_avg_bpm, 87);
});

test("sleep_analysis converts hours to whole minutes and counts a session", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("sleep_analysis", [
      {
        date: "2026-06-11 00:00:00 +0200",
        totalSleep: 7.6191186057527851,
        deep: 0.61617515110307264,
        rem: 2.1067369917697372,
        core: 4.8962064628799755,
        awake: 0.12490328583452437,
      },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.total_sleep_min, 457);
  assert.equal(row.deep_sleep_min, 37);
  assert.equal(row.rem_sleep_min, 126);
  assert.equal(row.core_sleep_min, 294);
  assert.equal(row.awake_min, 7);
  assert.equal(row.sleep_sessions, 1);
});

test("unmodelled metrics are ignored without skipping", () => {
  const agg = new JsonAggregator();
  agg.addMetric(metric("some_future_metric", [{ date: "2026-06-11 00:00:00 +0200", qty: 1 }]));
  assert.equal(agg.finalize().length, 0);
  assert.equal(agg.recordsSkipped, 0);
  assert.equal(agg.recordsParsed, 0);
});

test("points with an unparseable date are skipped", () => {
  const agg = new JsonAggregator();
  agg.addMetric(metric("step_count", [{ date: "not-a-date", qty: 100 }]));
  assert.equal(agg.recordsSkipped, 1);
  assert.equal(agg.finalize().length, 0);
});

test("points with a non-numeric qty are skipped, not stored as NaN", () => {
  const agg = new JsonAggregator();
  agg.addMetric(metric("step_count", [{ date: "2026-06-11 00:00:00 +0200", qty: "oops" }]));
  assert.equal(agg.recordsSkipped, 1);
  assert.equal(agg.finalize().length, 0);
});

test("records before the cutoff are dropped", () => {
  const cutoffEpoch = Date.UTC(2026, 5, 14);
  const agg = new JsonAggregator({ cutoffEpoch });
  agg.addMetric(
    metric("step_count", [
      { date: "2026-06-11 00:00:00 +0200", qty: 100 },
      { date: "2026-06-17 00:00:00 +0200", qty: 200 },
    ])
  );
  const rows = agg.finalize();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-17");
  assert.equal(rows[0].step_count, 200);
});

test("rows are sorted ascending by date", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("step_count", [
      { date: "2026-06-17 00:00:00 +0200", qty: 1 },
      { date: "2026-06-11 00:00:00 +0200", qty: 2 },
      { date: "2026-06-14 00:00:00 +0200", qty: 3 },
    ])
  );
  assert.deepEqual(
    agg.finalize().map((r) => r.date),
    ["2026-06-11", "2026-06-14", "2026-06-17"]
  );
});

test("parseJsonExport rejects a document without data.metrics", () => {
  assert.throws(() => parseJsonExport({}), /missing data\.metrics/);
  assert.throws(() => parseJsonExport({ data: {} }), /missing data\.metrics/);
});

test("parseJsonExport handles the real Health Auto Export sample end-to-end", () => {
  const { rows, recordsParsed, recordsSkipped } = parseJsonExport(fixture);

  assert.equal(recordsSkipped, 0);
  assert.ok(recordsParsed > 0);

  // Eight calendar days span 2026-06-11 .. 2026-06-18.
  assert.deepEqual(rows.map((r) => r.date), [
    "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14",
    "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
  ]);

  const d11 = rows.find((r) => r.date === "2026-06-11");
  assert.equal(d11.exercise_min, 88);
  assert.equal(d11.step_count, 14420);
  assert.equal(d11.heart_rate_max_bpm, 137);
  assert.equal(d11.resting_hr_bpm, 69);
  assert.equal(d11.sleep_sessions, 1);
  assert.equal(d11.total_sleep_min, 457);

  // Body composition only reported from 2026-06-15 onward.
  assert.equal(d11.body_mass_kg, undefined);
  const d15 = rows.find((r) => r.date === "2026-06-15");
  assert.equal(d15.body_mass_kg, 82.8);
});
