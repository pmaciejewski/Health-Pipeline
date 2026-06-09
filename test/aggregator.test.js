import { test } from "node:test";
import assert from "node:assert/strict";
import { Aggregator, parseAppleDate } from "../src/parser/aggregator.js";

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

test("HRV uses the minimum value of the day", () => {
  const agg = new Aggregator();
  for (const v of ["52.3", "42.1", "61.0"]) {
    agg.addRecord({
      type: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      startDate: "2026-06-08 04:00:00 +0100",
      endDate: "2026-06-08 04:00:00 +0100",
      value: v,
    });
  }
  assert.equal(agg.finalize()[0].hrv_ms, 42.1);
});

test("body mass keeps the latest reading of the day", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKQuantityTypeIdentifierBodyMass",
    startDate: "2026-06-08 21:30:00 +0100",
    endDate: "2026-06-08 21:30:00 +0100",
    value: "82.4",
  });
  agg.addRecord({
    type: "HKQuantityTypeIdentifierBodyMass",
    startDate: "2026-06-08 08:00:00 +0100",
    endDate: "2026-06-08 08:00:00 +0100",
    value: "82.9",
  });
  assert.equal(agg.finalize()[0].body_mass_kg, 82.4);
});

test("sleep session spanning midnight is attributed to the wake-up date", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-07 23:45:00 +0100",
    endDate: "2026-06-08 01:45:00 +0100",
    value: "HKCategoryValueSleepAnalysisAsleepCore",
  });
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-08 01:45:00 +0100",
    endDate: "2026-06-08 02:33:00 +0100",
    value: "HKCategoryValueSleepAnalysisAsleepDeep",
  });
  const rows = agg.finalize();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-08");
  assert.equal(rows[0].core_sleep_min, 120);
  assert.equal(rows[0].deep_sleep_min, 48);
  assert.equal(rows[0].total_sleep_min, 168);
  assert.equal(rows[0].sleep_sessions, 1);
});

test("awake time is excluded from total sleep", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-08 01:00:00 +0100",
    endDate: "2026-06-08 02:00:00 +0100",
    value: "HKCategoryValueSleepAnalysisAsleepCore",
  });
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-08 02:00:00 +0100",
    endDate: "2026-06-08 02:13:00 +0100",
    value: "HKCategoryValueSleepAnalysisAwake",
  });
  const [row] = agg.finalize();
  assert.equal(row.total_sleep_min, 60);
  assert.equal(row.awake_min, 13);
});

test("gap over 30 minutes starts a new session; nap counted separately", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-08 01:00:00 +0100",
    endDate: "2026-06-08 07:00:00 +0100",
    value: "HKCategoryValueSleepAnalysisAsleepCore",
  });
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-08 14:00:00 +0100",
    endDate: "2026-06-08 14:40:00 +0100",
    value: "HKCategoryValueSleepAnalysisAsleepUnspecified",
  });
  const [row] = agg.finalize();
  assert.equal(row.sleep_sessions, 2);
  // Unspecified stage counts toward total but no individual stage.
  assert.equal(row.total_sleep_min, 360 + 40);
  assert.equal(row.core_sleep_min, 360);
});

test("InBed segments are ignored entirely", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: "2026-06-07 23:30:00 +0100",
    endDate: "2026-06-07 23:45:00 +0100",
    value: "HKCategoryValueSleepAnalysisInBed",
  });
  assert.equal(agg.finalize().length, 0);
});

test("missing metrics are null, never 0", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    startDate: "2026-06-09 03:10:00 +0100",
    endDate: "2026-06-09 03:10:00 +0100",
    value: "48.2",
  });
  const [row] = agg.finalize();
  assert.equal(row.hrv_ms, 48.2);
  assert.equal(row.resting_hr_bpm, null);
  assert.equal(row.total_sleep_min, null);
  assert.equal(row.sleep_sessions, null);
  assert.equal(row.body_mass_kg, null);
});

test("records before the cutoff are dropped", () => {
  const cutoffEpoch = Date.UTC(2026, 5, 1);
  const agg = new Aggregator({ cutoffEpoch });
  agg.addRecord({
    type: "HKQuantityTypeIdentifierRestingHeartRate",
    startDate: "2026-05-15 07:00:00 +0100",
    endDate: "2026-05-15 07:00:00 +0100",
    value: "54",
  });
  agg.addRecord({
    type: "HKQuantityTypeIdentifierRestingHeartRate",
    startDate: "2026-06-05 07:00:00 +0100",
    endDate: "2026-06-05 07:00:00 +0100",
    value: "55",
  });
  const rows = agg.finalize();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-05");
});

test("body fat, BMI and lean mass keep the latest reading of the day", () => {
  const agg = new Aggregator();
  // Two body-fat readings; latest wins
  agg.addRecord({ type: "HKQuantityTypeIdentifierBodyFatPercentage", startDate: "2026-06-08 08:00:00 +0100", endDate: "2026-06-08 08:00:00 +0100", value: "19.0" });
  agg.addRecord({ type: "HKQuantityTypeIdentifierBodyFatPercentage", startDate: "2026-06-08 21:00:00 +0100", endDate: "2026-06-08 21:00:00 +0100", value: "18.5" });
  agg.addRecord({ type: "HKQuantityTypeIdentifierBodyMassIndex",     startDate: "2026-06-08 08:01:00 +0100", endDate: "2026-06-08 08:01:00 +0100", value: "24.7" });
  agg.addRecord({ type: "HKQuantityTypeIdentifierLeanBodyMass",      startDate: "2026-06-08 08:02:00 +0100", endDate: "2026-06-08 08:02:00 +0100", value: "67.2" });
  const [row] = agg.finalize();
  assert.equal(row.body_fat_pct,      18.5);
  assert.equal(row.bmi,               24.7);
  assert.equal(row.lean_body_mass_kg, 67.2);
});

test("body_fat_pct and bmi are rounded to 2 decimal places", () => {
  const agg = new Aggregator();
  agg.addRecord({ type: "HKQuantityTypeIdentifierBodyFatPercentage", startDate: "2026-06-08 08:00:00 +0100", endDate: "2026-06-08 08:00:00 +0100", value: "18.556" });
  agg.addRecord({ type: "HKQuantityTypeIdentifierBodyMassIndex",     startDate: "2026-06-08 08:00:00 +0100", endDate: "2026-06-08 08:00:00 +0100", value: "24.749" });
  const [row] = agg.finalize();
  assert.equal(row.body_fat_pct, 18.56);
  assert.equal(row.bmi,          24.75);
});

test("new body-weight fields are null when absent", () => {
  const agg = new Aggregator();
  agg.addRecord({ type: "HKQuantityTypeIdentifierRestingHeartRate", startDate: "2026-06-08 07:00:00 +0100", endDate: "2026-06-08 07:00:00 +0100", value: "54" });
  const [row] = agg.finalize();
  assert.equal(row.body_fat_pct,      null);
  assert.equal(row.bmi,               null);
  assert.equal(row.lean_body_mass_kg, null);
});

test("malformed records are counted as skipped, not thrown", () => {
  const agg = new Aggregator();
  agg.addRecord({
    type: "HKQuantityTypeIdentifierBodyMass",
    startDate: "not-a-date",
    endDate: "not-a-date",
    value: "80",
  });
  assert.equal(agg.recordsSkipped, 1);
  assert.equal(agg.finalize().length, 0);
});

test("rows are sorted ascending by date", () => {
  const agg = new Aggregator();
  for (const day of ["09", "07", "08"]) {
    agg.addRecord({
      type: "HKQuantityTypeIdentifierRestingHeartRate",
      startDate: `2026-06-${day} 07:00:00 +0100`,
      endDate: `2026-06-${day} 07:00:00 +0100`,
      value: "54",
    });
  }
  assert.deepEqual(
    agg.finalize().map((r) => r.date),
    ["2026-06-07", "2026-06-08", "2026-06-09"]
  );
});
