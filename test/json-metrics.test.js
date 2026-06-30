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

test("sleep attributed to sleepEnd day when session starts before midnight", () => {
  // Bedtime 23:49 Jun 29, wakeup 07:47 Jun 30: the date field may carry the
  // bedtime timestamp ("2026-06-29 23:49:00 +0200") but sleepEnd is always the
  // wakeup timestamp. The session must land on Jun 30 to match Apple Health.
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("sleep_analysis", [
      {
        date: "2026-06-29 23:49:00 +0200",
        sleepEnd: "2026-06-30 07:47:00 +0200",
        totalSleep: 7.967,
        deep: 1.2,
        rem: 2.1,
        core: 4.667,
        awake: 0.2,
      },
    ])
  );
  const rows = agg.finalize();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-30");
  assert.equal(rows[0].total_sleep_min, 478); // round(7.967 * 60)
  assert.equal(rows[0].sleep_sessions, 1);
});

test("sleep falls back to date field when sleepEnd is absent", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("sleep_analysis", [
      {
        date: "2026-06-30 00:00:00 +0200",
        totalSleep: 7.967,
        deep: 1.2,
        rem: 2.1,
        core: 4.667,
        awake: 0.2,
      },
    ])
  );
  const rows = agg.finalize();
  assert.equal(rows[0].date, "2026-06-30");
  assert.equal(rows[0].total_sleep_min, 478);
});

test("additive metrics sum across multiple same-day entries (e.g. per-source)", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("step_count", [
      { date: "2026-06-24 00:00:00 +0200", qty: 8200, source: "Paweł's Apple Watch" },
      { date: "2026-06-24 00:00:00 +0200", qty: 1300, source: "Romuald" },
    ])
  );
  agg.addMetric(
    metric("walking_running_distance", [
      { date: "2026-06-24 00:00:00 +0200", qty: 5.8, source: "Paweł's Apple Watch" },
      { date: "2026-06-24 00:00:00 +0200", qty: 0.9, source: "Romuald" },
    ])
  );
  agg.addMetric(
    metric("active_energy", [
      { date: "2026-06-24 00:00:00 +0200", qty: 2100.5, source: "Paweł's Apple Watch" },
      { date: "2026-06-24 00:00:00 +0200", qty:  410.25, source: "Romuald" },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.step_count, 9500);
  assert.equal(row.walking_running_km, 6.7);
  assert.equal(row.active_energy_kj, 2510.75);
});

test("non-additive metrics use last-write-wins for same-day entries", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("resting_heart_rate", [
      { date: "2026-06-24 00:00:00 +0200", qty: 65, source: "Paweł's Apple Watch" },
      { date: "2026-06-24 00:00:00 +0200", qty: 68, source: "Withings" },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.resting_hr_bpm, 68);
});

test("multiple sleep sessions on the same day accumulate all duration fields", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("sleep_analysis", [
      {
        date: "2026-06-24 00:00:00 +0200",
        totalSleep: 6.5,
        deep: 1.0,
        rem: 1.5,
        core: 4.0,
        awake: 0.1,
      },
      {
        date: "2026-06-24 00:00:00 +0200",
        totalSleep: 1.0,
        deep: 0.0,
        rem: 0.5,
        core: 0.5,
        awake: 0.05,
      },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.sleep_sessions, 2);
  assert.equal(row.total_sleep_min, 450);   // (6.5 + 1.0) * 60
  assert.equal(row.deep_sleep_min, 60);     // (1.0 + 0.0) * 60
  assert.equal(row.rem_sleep_min, 120);     // (1.5 + 0.5) * 60
  assert.equal(row.core_sleep_min, 270);    // (4.0 + 0.5) * 60
  assert.equal(row.awake_min, 9);           // round((0.1 + 0.05) * 60)
});

test("heart_rate tracks true daily min and max across multiple entries", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("heart_rate", [
      { date: "2026-06-24 00:00:00 +0200", Min: 58, Max: 130, Avg: 80, source: "Watch" },
      { date: "2026-06-24 00:00:00 +0200", Min: 62, Max: 175, Avg: 95, source: "Withings" },
    ])
  );
  const [row] = agg.finalize();
  assert.equal(row.heart_rate_min_bpm, 58);   // true minimum across both entries
  assert.equal(row.heart_rate_max_bpm, 175);  // true maximum across both entries
});

test("raw points are collected for qty metrics with timestamp and value", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("step_count", [
      { date: "2026-06-24 08:15:00 +0200", qty: 500, source: "Watch" },
      { date: "2026-06-24 09:30:00 +0200", qty: 300, source: "Watch" },
    ])
  );
  assert.equal(agg.rawPoints.length, 2);
  const [p1, p2] = agg.rawPoints;
  assert.equal(p1.pk, "RAW#2026-06-24");
  assert.ok(p1.sk.startsWith("step_count#"));
  assert.equal(p1.metric, "step_count");
  assert.equal(p1.v, 500);
  assert.equal(p1.source, "Watch");
  assert.equal(typeof p1.epoch, "number");
  assert.ok(p1.epoch < p2.epoch); // chronological order
});

test("raw heart_rate points capture min/max/avg per measurement interval", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("heart_rate", [
      { date: "2026-06-24 09:00:00 +0200", Min: 72, Max: 85, Avg: 78.4, source: "Watch" },
    ])
  );
  const [p] = agg.rawPoints;
  assert.equal(p.pk, "RAW#2026-06-24");
  assert.ok(p.sk.startsWith("heart_rate#"));
  assert.equal(p.metric, "heart_rate");
  assert.equal(p.min, 72);
  assert.equal(p.max, 85);
  assert.equal(p.avg, 78);
  assert.equal(p.source, "Watch");
});

test("raw sleep point pk uses sleepEnd date and includes stage durations", () => {
  const agg = new JsonAggregator();
  agg.addMetric(
    metric("sleep_analysis", [
      {
        date: "2026-06-29 23:49:00 +0200",
        sleepEnd: "2026-06-30 07:47:00 +0200",
        sleepStart: "2026-06-29 23:49:00 +0200",
        totalSleep: 7.967,
        deep: 1.2,
        rem: 2.1,
        core: 4.667,
        awake: 0.2,
      },
    ])
  );
  const [p] = agg.rawPoints;
  assert.equal(p.pk, "RAW#2026-06-30");
  assert.ok(p.sk.startsWith("sleep_analysis#"));
  assert.equal(p.metric, "sleep_analysis");
  assert.equal(p.sleep_start, "2026-06-29 23:49:00 +0200");
  assert.equal(p.total_sleep_min, 478);
  assert.equal(p.deep_sleep_min, 72);
});

test("parseJsonExport envelope includes rawPoints array", () => {
  const { rawPoints } = parseJsonExport(fixture);
  assert.ok(Array.isArray(rawPoints));
  assert.ok(rawPoints.length > 0);
  assert.ok(rawPoints.every((p) => p.pk?.startsWith("RAW#")));
  assert.ok(rawPoints.every((p) => typeof p.epoch === "number"));
  assert.ok(rawPoints.every((p) => p.sk?.includes("#")));
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
