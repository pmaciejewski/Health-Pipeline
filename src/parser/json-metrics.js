// Parser for the "Health Auto Export" iOS app JSON feed.
//
// Shape: { "data": { "metrics": [ { name, units, data: [ { date, qty, source, ... } ] } ] } }
//
// The app can export at daily granularity (one point per metric per day) or at a
// finer granularity (hourly buckets — several points per metric per day). We fold
// every point that lands on the same calendar day into a single per-day row using
// each metric's natural daily aggregation: cumulative metrics (steps, energy,
// distance, minutes) sum; rates and measurements (heart rate, SpO2, speed) average;
// heart_rate keeps the day's min/max and mean. A daily-granularity export is just
// the degenerate case of one point per day, so it aggregates to that same value.

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

// Plain single-quantity daily metrics: JSON metric name -> output field, rounding,
// and the daily aggregation used to fold multiple intra-day points into one row.
//   "sum" — cumulative totals (steps, energy, distance, minutes counted over the day)
//   "avg" — rates and point-in-time measurements (heart rate, SpO2, speed, weight)
// Field names carry units to stay self-describing alongside the XML-derived rows.
const QTY_METRICS = {
  heart_rate_variability:            { field: "hrv_ms",                     round: 2, agg: "avg" },
  resting_heart_rate:                { field: "resting_hr_bpm",             round: 0, agg: "avg" },
  weight_body_mass:                  { field: "body_mass_kg",               round: 2, agg: "avg" },
  body_fat_percentage:               { field: "body_fat_pct",               round: 2, agg: "avg" },
  body_mass_index:                   { field: "bmi",                        round: 2, agg: "avg" },
  lean_body_mass:                    { field: "lean_body_mass_kg",          round: 2, agg: "avg" },
  apple_exercise_time:               { field: "exercise_min",               round: 0, agg: "sum" },
  active_energy:                     { field: "active_energy_kj",           round: 2, agg: "sum" },
  basal_energy_burned:               { field: "basal_energy_kj",            round: 2, agg: "sum" },
  apple_stand_hour:                  { field: "stand_hours",                round: 0, agg: "sum" },
  apple_stand_time:                  { field: "stand_min",                  round: 0, agg: "sum" },
  apple_sleeping_wrist_temperature:  { field: "sleeping_wrist_temp_c",      round: 2, agg: "avg" },
  blood_oxygen_saturation:           { field: "blood_oxygen_pct",           round: 2, agg: "avg" },
  environmental_audio_exposure:      { field: "environmental_audio_db",     round: 2, agg: "avg" },
  headphone_audio_exposure:          { field: "headphone_audio_db",         round: 2, agg: "avg" },
  flights_climbed:                   { field: "flights_climbed",            round: 0, agg: "sum" },
  physical_effort:                   { field: "physical_effort",            round: 2, agg: "avg" },
  respiratory_rate:                  { field: "respiratory_rate_bpm",       round: 2, agg: "avg" },
  step_count:                        { field: "step_count",                 round: 0, agg: "sum" },
  time_in_daylight:                  { field: "time_in_daylight_min",       round: 0, agg: "sum" },
  vo2_max:                           { field: "vo2_max",                    round: 2, agg: "avg" },
  walking_running_distance:          { field: "walking_running_km",         round: 3, agg: "sum" },
  walking_heart_rate_average:        { field: "walking_hr_avg_bpm",         round: 0, agg: "avg" },
  six_minute_walking_test_distance:  { field: "six_minute_walk_m",          round: 0, agg: "avg" },
  stair_speed_up:                    { field: "stair_speed_up_ms",          round: 3, agg: "avg" },
  stair_speed_down:                  { field: "stair_speed_down_ms",        round: 3, agg: "avg" },
  walking_asymmetry_percentage:      { field: "walking_asymmetry_pct",      round: 2, agg: "avg" },
  walking_double_support_percentage: { field: "walking_double_support_pct", round: 2, agg: "avg" },
  walking_speed:                     { field: "walking_speed_kmh",          round: 2, agg: "avg" },
  walking_step_length:               { field: "walking_step_length_cm",     round: 1, agg: "avg" },
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
    this.recordsParsed = 0;
    this.recordsSkipped = 0;
  }

  #day(date) {
    let d = this.days.get(date);
    if (!d) {
      d = new Map();
      this.days.set(date, d);
    }
    return d;
  }

  // Fold one value into a day's running accumulator for `field`. Several points
  // landing on the same day combine per `agg` ("sum" or "avg"); the final number
  // is computed (and rounded) in finalize(), so summing/averaging stays exact.
  #accumulate(date, field, value, { agg, round }) {
    const day = this.#day(date);
    let a = day.get(field);
    if (!a) {
      a = { sum: 0, count: 0, min: Infinity, max: -Infinity, agg, round };
      day.set(field, a);
    }
    a.sum += value;
    a.count += 1;
    if (value < a.min) a.min = value;
    if (value > a.max) a.max = value;
  }

  // Resolve a point's local calendar day, honouring the cutoff window.
  // Returns the day string, or null when the point is unusable/too old.
  #bucket(point) {
    const t = parseAppleDate(point?.date);
    if (!t) {
      this.recordsSkipped++;
      return null;
    }
    if (t.epoch < this.cutoffEpoch) return null;
    return t.localDate;
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
    const date = this.#bucket(point);
    if (!date) return;
    this.#accumulate(date, spec.field, v, spec);
    this.recordsParsed++;
  }

  #addHeartRate(point) {
    const min = Number(point?.Min);
    const max = Number(point?.Max);
    const avg = Number(point?.Avg);
    if (![min, max, avg].some(Number.isFinite))
      return void this.recordsSkipped++;
    const date = this.#bucket(point);
    if (!date) return;
    // Across a day's hourly buckets: lowest Min, highest Max, mean of the Avgs.
    if (Number.isFinite(min))
      this.#accumulate(date, "heart_rate_min_bpm", min, { agg: "min", round: 0 });
    if (Number.isFinite(max))
      this.#accumulate(date, "heart_rate_max_bpm", max, { agg: "max", round: 0 });
    if (Number.isFinite(avg))
      this.#accumulate(date, "heart_rate_avg_bpm", avg, { agg: "avg", round: 0 });
    this.recordsParsed++;
  }

  #addSleep(point) {
    const date = this.#bucket(point);
    if (!date) return;
    // A day may hold more than one sleep session; sum the stage minutes and
    // count the sessions so a fragmented night still totals correctly.
    for (const [src, field] of Object.entries(SLEEP_FIELDS)) {
      const hours = Number(point?.[src]);
      if (Number.isFinite(hours))
        this.#accumulate(date, field, hours * 60, { agg: "sum", round: 0 });
    }
    this.#accumulate(date, "sleep_sessions", 1, { agg: "sum", round: 0 });
    this.recordsParsed++;
  }

  finalize() {
    return [...this.days.entries()]
      .map(([date, fields]) => {
        const row = { date };
        for (const [field, a] of fields) {
          const value =
            a.agg === "sum" ? a.sum
            : a.agg === "min" ? a.min
            : a.agg === "max" ? a.max
            : a.sum / a.count; // "avg"
          row[field] = round(value, a.round);
        }
        return row;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

// Parse a Health Auto Export document into per-day rows.
// Returns the same envelope as the XML path so callers stay uniform.
export function parseJsonExport(json, { cutoffEpoch = -Infinity } = {}) {
  const metrics = json?.data?.metrics;
  if (!Array.isArray(metrics))
    throw new Error("Unrecognised JSON export: missing data.metrics array");

  const agg = new JsonAggregator({ cutoffEpoch });
  for (const metric of metrics) agg.addMetric(metric);

  return {
    rows: agg.finalize(),
    recordsParsed: agg.recordsParsed,
    recordsSkipped: agg.recordsSkipped,
  };
}
