import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  JsonAggregator,
  parseJsonExport,
  parseAppleDate,
  collectRaw,
} from "../src/parser/json-metrics.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/health-auto-export-sample.json", import.meta.url)),
    "utf8"
  )
);

// A second real export, this time at hourly granularity (many points per metric
// per calendar day) spanning 2026-06-18 .. 2026-06-19.
const hourlyFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/health-auto-export-hourly.json", import.meta.url)),
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

test("multiple intra-day points on a cumulative metric are summed", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("step_count", [
      { date: "2026-06-18 17:00:00 +0200", qty: 5863 },
      { date: "2026-06-18 18:00:00 +0200", qty: 1746 },
      { date: "2026-06-18 19:00:00 +0200", qty: 391 },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.step_count, 8000);
});

test("multiple intra-day points on a rate metric are averaged", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("blood_oxygen_saturation", [
      { date: "2026-06-18 00:00:00 +0200", qty: 96 },
      { date: "2026-06-18 01:00:00 +0200", qty: 98 },
      { date: "2026-06-18 02:00:00 +0200", qty: 100 },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.blood_oxygen_pct, 98);
});

test("heart_rate over a day keeps the lowest Min, highest Max and mean Avg", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("heart_rate", [
      { date: "2026-06-18 00:00:00 +0200", Min: 66, Max: 84, Avg: 70 },
      { date: "2026-06-18 12:00:00 +0200", Min: 56, Max: 114, Avg: 92 },
      { date: "2026-06-18 18:00:00 +0200", Min: 65, Max: 145, Avg: 108 },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.heart_rate_min_bpm, 56);
  assert.equal(row.heart_rate_max_bpm, 145);
  assert.equal(row.heart_rate_avg_bpm, 90); // (70 + 92 + 108) / 3
});

test("two sleep sessions in one day sum their minutes and count both", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("sleep_analysis", [
      { date: "2026-06-18 00:00:00 +0200", totalSleep: 1, deep: 0.5 },
      { date: "2026-06-18 00:00:00 +0200", totalSleep: 2, deep: 0.5 },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.total_sleep_min, 180); // (1 + 2) hours
  assert.equal(row.deep_sleep_min, 60); // (0.5 + 0.5) hours
  assert.equal(row.sleep_sessions, 2);
});

test("parseJsonExport folds the real hourly export into per-day rows", () => {
  const { rows, recordsSkipped } = parseJsonExport(hourlyFixture);

  assert.equal(recordsSkipped, 0);
  assert.deepEqual(rows.map((r) => r.date), ["2026-06-18", "2026-06-19"]);

  const d18 = rows.find((r) => r.date === "2026-06-18");
  // step_count is a sum of every hourly bucket, not just the last hour's 8.
  assert.equal(d18.step_count, 8699);
  // heart_rate folds the day's hourly min/max envelopes.
  assert.equal(d18.heart_rate_min_bpm, 56);
  assert.equal(d18.heart_rate_max_bpm, 145);
  // Single-reading-per-day metrics still pass straight through.
  assert.equal(d18.resting_hr_bpm, 69);
  assert.equal(d18.body_mass_kg, 82.46);

  const d19 = rows.find((r) => r.date === "2026-06-19");
  assert.equal(d19.step_count, 1456);
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

test("collectRaw groups every metric's points by day, keeping unmodelled ones", () => {
  const raw = collectRaw([
    metric("step_count", [
      { date: "2026-06-18 07:00:00 +0200", qty: 5 },
      { date: "2026-06-18 08:00:00 +0200", qty: 9 },
      { date: "2026-06-19 07:00:00 +0200", qty: 2 },
    ]),
    metric("some_future_metric", [{ date: "2026-06-18 09:00:00 +0200", qty: 1 }]),
  ]);
  // One bucket per (day, metric), sorted by day then metric name.
  assert.deepEqual(
    raw.map((r) => `${r.date} ${r.metric}`),
    [
      "2026-06-18 some_future_metric",
      "2026-06-18 step_count",
      "2026-06-19 step_count",
    ]
  );
  const steps18 = raw.find(
    (r) => r.date === "2026-06-18" && r.metric === "step_count"
  );
  assert.equal(steps18.points.length, 2);
  assert.equal(steps18.units, "count");
});

test("collectRaw drops points before the cutoff and unparseable dates", () => {
  const cutoffEpoch = Date.UTC(2026, 5, 14);
  const raw = collectRaw(
    [
      metric("step_count", [
        { date: "2026-06-11 00:00:00 +0200", qty: 100 },
        { date: "not-a-date", qty: 1 },
        { date: "2026-06-17 00:00:00 +0200", qty: 200 },
      ]),
    ],
    { cutoffEpoch }
  );
  assert.equal(raw.length, 1);
  assert.equal(raw[0].date, "2026-06-17");
  assert.equal(raw[0].points.length, 1);
});

test("parseJsonExport returns raw points alongside daily rows", () => {
  const { rows, raw } = parseJsonExport(hourlyFixture);
  assert.ok(rows.length > 0);

  const steps18 = raw.find(
    (r) => r.date === "2026-06-18" && r.metric === "step_count"
  );
  assert.equal(steps18.units, "count");
  assert.equal(steps18.points.length, 15);
  // Every metric/day combination is preserved, not just the modelled ones.
  assert.ok(raw.some((r) => r.metric === "sleep_analysis"));
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
