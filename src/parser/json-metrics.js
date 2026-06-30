// Parser for the "Health Auto Export" iOS app JSON feed.
//
// Shape: { "data": { "metrics": [ { name, units, data: [ { date, qty, source, ... } ] } ] } }
//
// Supports both daily-summary exports (one aggregated point per metric per day)
// and raw backup exports (one point per measurement, sub-daily granularity).
// Daily aggregates are written to DynamoDB DAY rows; individual measurements are
// written to RAW#<date> rows so the MCP layer can expose both granularities.

// Health Auto Export timestamps look like "2026-06-11 00:00:00 +0200": the
// date/time is local, the trailing offset converts it to an absolute epoch.
const APPLE_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

export function parseAppleDate(str) {
  const m = APPLE_DATE_RE.exec(str ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const offsetMs =
    (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60000;
  const epoch = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMs;
  return { epoch, localDate: `${y}-${mo}-${d}` };
}

function round(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// Zero-pad epoch (ms) to 15 digits so DynamoDB sk sorts chronologically.
function epochKey(epoch) {
  return epoch.toString().padStart(15, "0");
}

// Plain single-quantity daily metrics: JSON metric name -> output field + rounding.
// Field names carry units to stay self-describing alongside the XML-derived rows.
//
// sum: true marks metrics that accumulate throughout the day (steps, distance,
// energy burned, exercise time, etc.). When a feed contains multiple points for
// the same metric on the same day — e.g. one entry per source device — those
// values are summed rather than the last one silently winning.
const QTY_METRICS = {
  heart_rate_variability:            { field: "hrv_ms",                     round: 2 },
  resting_heart_rate:                { field: "resting_hr_bpm",             round: 0 },
  weight_body_mass:                  { field: "body_mass_kg",               round: 2 },
  body_fat_percentage:               { field: "body_fat_pct",               round: 2 },
  body_mass_index:                   { field: "bmi",                        round: 2 },
  lean_body_mass:                    { field: "lean_body_mass_kg",          round: 2 },
  apple_exercise_time:               { field: "exercise_min",               round: 0, sum: true },
  active_energy:                     { field: "active_energy_kj",           round: 2, sum: true },
  basal_energy_burned:               { field: "basal_energy_kj",            round: 2, sum: true },
  apple_stand_hour:                  { field: "stand_hours",                round: 0, sum: true },
  apple_stand_time:                  { field: "stand_min",                  round: 0, sum: true },
  apple_sleeping_wrist_temperature:  { field: "sleeping_wrist_temp_c",      round: 2 },
  blood_oxygen_saturation:           { field: "blood_oxygen_pct",           round: 2 },
  environmental_audio_exposure:      { field: "environmental_audio_db",     round: 2 },
  headphone_audio_exposure:          { field: "headphone_audio_db",         round: 2 },
  flights_climbed:                   { field: "flights_climbed",            round: 0, sum: true },
  physical_effort:                   { field: "physical_effort",            round: 2 },
  respiratory_rate:                  { field: "respiratory_rate_bpm",       round: 2 },
  step_count:                        { field: "step_count",                 round: 0, sum: true },
  time_in_daylight:                  { field: "time_in_daylight_min",       round: 0, sum: true },
  vo2_max:                           { field: "vo2_max",                    round: 2 },
  walking_running_distance:          { field: "walking_running_km",         round: 3, sum: true },
  walking_heart_rate_average:        { field: "walking_hr_avg_bpm",         round: 0 },
  six_minute_walking_test_distance:  { field: "six_minute_walk_m",          round: 0 },
  stair_speed_up:                    { field: "stair_speed_up_ms",          round: 3 },
  stair_speed_down:                  { field: "stair_speed_down_ms",        round: 3 },
  walking_asymmetry_percentage:      { field: "walking_asymmetry_pct",      round: 2 },
  walking_double_support_percentage: { field: "walking_double_support_pct", round: 2 },
  walking_speed:                     { field: "walking_speed_kmh",          round: 2 },
  walking_step_length:               { field: "walking_step_length_cm",     round: 1 },
};

// sleep_analysis points carry per-stage durations in hours; convert to minutes
// so they line up with the XML-derived total_sleep_min/deep_sleep_min/... fields.
const SLEEP_FIELDS = {
  totalSleep: "total_sleep_min",
  deep:       "deep_sleep_min",
  rem:        "rem_sleep_min",
  core:       "core_sleep_min",
  awake:      "awake_min",
};

export class JsonAggregator {
  constructor({ cutoffEpoch = -Infinity } = {}) {
    this.cutoffEpoch = cutoffEpoch;
    this.days = new Map();
    this.rawPoints = [];
    this.recordsParsed = 0;
    this.recordsSkipped = 0;
  }

  #day(date) {
    let d = this.days.get(date);
    if (!d) {
      d = {};
      this.days.set(date, d);
    }
    return d;
  }

  // Resolve a date string → day bucket, honouring the cutoff window.
  // Returns null (and increments recordsSkipped) when the string won't parse.
  #resolve(dateStr) {
    const t = parseAppleDate(dateStr);
    if (!t) {
      this.recordsSkipped++;
      return null;
    }
    if (t.epoch < this.cutoffEpoch) return null;
    return this.#day(t.localDate);
  }

  // Resolve a point's local calendar day via its `date` field.
  #bucket(point) {
    return this.#resolve(point?.date);
  }

  addMetric(metric) {
    const name = metric?.name;
    const points = Array.isArray(metric?.data) ? metric.data : [];

    if (name === "sleep_analysis") {
      for (const p of points) this.#addSleep(p);
      return;
    }
    if (name === "heart_rate") {
      for (const p of points) this.#addHeartRate(p);
      return;
    }
    const spec = QTY_METRICS[name];
    if (!spec) return; // metric not modelled yet — ignore silently
    for (const p of points) this.#addQty(p, spec);
  }

  #addQty(point, spec) {
    const v = Number(point?.qty);
    if (!Number.isFinite(v)) return void this.recordsSkipped++;
    const d = this.#bucket(point);
    if (!d) return;
    d[spec.field] = spec.sum
      ? round((d[spec.field] ?? 0) + v, spec.round)
      : round(v, spec.round);
    this.recordsParsed++;

    // Raw time-series point: one item per measurement.
    const t = parseAppleDate(point.date);
    if (t) {
      const raw = {
        pk: `RAW#${t.localDate}`,
        sk: `${spec.field}#${epochKey(t.epoch)}`,
        metric: spec.field,
        ts: point.date,
        epoch: t.epoch,
        v: round(v, spec.round),
      };
      if (point.source) raw.source = point.source;
      this.rawPoints.push(raw);
    }
  }

  #addHeartRate(point) {
    const min = Number(point?.Min);
    const max = Number(point?.Max);
    const avg = Number(point?.Avg);
    if (![min, max, avg].some(Number.isFinite))
      return void this.recordsSkipped++;
    const d = this.#bucket(point);
    if (!d) return;
    if (Number.isFinite(min))
      d.heart_rate_min_bpm = d.heart_rate_min_bpm == null
        ? round(min, 0)
        : Math.min(d.heart_rate_min_bpm, round(min, 0));
    if (Number.isFinite(max))
      d.heart_rate_max_bpm = d.heart_rate_max_bpm == null
        ? round(max, 0)
        : Math.max(d.heart_rate_max_bpm, round(max, 0));
    if (Number.isFinite(avg)) d.heart_rate_avg_bpm = round(avg, 0);
    this.recordsParsed++;

    // Raw time-series point: one item per measurement interval.
    const t = parseAppleDate(point?.date);
    if (t) {
      const raw = {
        pk: `RAW#${t.localDate}`,
        sk: `heart_rate#${epochKey(t.epoch)}`,
        metric: "heart_rate",
        ts: point.date,
        epoch: t.epoch,
      };
      if (Number.isFinite(min)) raw.min = round(min, 0);
      if (Number.isFinite(max)) raw.max = round(max, 0);
      if (Number.isFinite(avg)) raw.avg = round(avg, 0);
      if (point.source) raw.source = point.source;
      this.rawPoints.push(raw);
    }
  }

  #addSleep(point) {
    // Attribute the session to the wakeup (morning-of) calendar day by
    // preferring sleepEnd over the generic date field. Health Auto Export
    // sometimes stamps date with the bedtime local time (e.g.
    // "2026-06-29 23:49:00 +0200"), which would land the night on Jun 29
    // rather than Jun 30 where Apple Health shows it. sleepEnd is always
    // the actual wake-up timestamp, so it reliably gives the correct day.
    const sleepEndStr = point?.sleepEnd ?? point?.date;
    const d = this.#resolve(sleepEndStr);
    if (!d) return;
    for (const [src, field] of Object.entries(SLEEP_FIELDS)) {
      const hours = Number(point?.[src]);
      if (Number.isFinite(hours))
        d[field] = round((d[field] ?? 0) + hours * 60, 0);
    }
    d.sleep_sessions = (d.sleep_sessions ?? 0) + 1;
    this.recordsParsed++;

    // Raw sleep session point: one item per sleep session.
    const t = parseAppleDate(sleepEndStr);
    if (t) {
      const raw = {
        pk: `RAW#${t.localDate}`,
        sk: `sleep_analysis#${epochKey(t.epoch)}`,
        metric: "sleep_analysis",
        ts: sleepEndStr,
        epoch: t.epoch,
      };
      if (point.sleepStart != null) raw.sleep_start = point.sleepStart;
      for (const [src, field] of Object.entries(SLEEP_FIELDS)) {
        const hours = Number(point?.[src]);
        if (Number.isFinite(hours)) raw[field] = round(hours * 60, 0);
      }
      if (point.source) raw.source = point.source;
      this.rawPoints.push(raw);
    }
  }

  finalize() {
    return [...this.days.entries()]
      .map(([date, fields]) => ({ date, ...fields }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

// Parse a Health Auto Export document into per-day rows and raw time-series points.
export function parseJsonExport(json, { cutoffEpoch = -Infinity } = {}) {
  const metrics = json?.data?.metrics;
  if (!Array.isArray(metrics))
    throw new Error("Unrecognised JSON export: missing data.metrics array");

  const agg = new JsonAggregator({ cutoffEpoch });
  for (const metric of metrics) agg.addMetric(metric);

  return {
    rows: agg.finalize(),
    rawPoints: agg.rawPoints,
    recordsParsed: agg.recordsParsed,
    recordsSkipped: agg.recordsSkipped,
  };
}
