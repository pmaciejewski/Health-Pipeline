// Aggregates raw Apple Health records into per-calendar-day metric rows.

// Apple Health timestamps look like "2026-06-08 23:14:00 +0100".
// The date/time components are already in local time; the offset converts to epoch.
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

const SLEEP_STAGE = {
  HKCategoryValueSleepAnalysisAsleepDeep: "deep",
  HKCategoryValueSleepAnalysisAsleepREM: "rem",
  HKCategoryValueSleepAnalysisAsleepCore: "core",
  // Older watchOS exports a single unspecified asleep stage: counts toward
  // total sleep but no individual stage.
  HKCategoryValueSleepAnalysisAsleepUnspecified: "unspecified",
  HKCategoryValueSleepAnalysisAwake: "awake",
  HKCategoryValueSleepAnalysisInBed: "inbed",
};

const STAGE_FIELD = {
  deep: "deep_sleep_min",
  rem: "rem_sleep_min",
  core: "core_sleep_min",
  awake: "awake_min",
};

// Gap between sleep segments above which a new session starts.
const SESSION_GAP_MS = 30 * 60000;

export class Aggregator {
  constructor({ cutoffEpoch = -Infinity } = {}) {
    this.cutoffEpoch = cutoffEpoch;
    this.days = new Map();
    this.sleepSegments = [];
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

  addRecord({ type, startDate, endDate, value }) {
    switch (type) {
      case "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": {
        const t = parseAppleDate(startDate);
        const v = Number(value);
        if (!t || !Number.isFinite(v)) return void this.recordsSkipped++;
        if (t.epoch < this.cutoffEpoch) return;
        const d = this.#day(t.localDate);
        d.hrv_ms = d.hrv_ms == null ? v : Math.min(d.hrv_ms, v);
        this.recordsParsed++;
        return;
      }
      case "HKQuantityTypeIdentifierRestingHeartRate": {
        const t = parseAppleDate(startDate);
        const v = Number(value);
        if (!t || !Number.isFinite(v)) return void this.recordsSkipped++;
        if (t.epoch < this.cutoffEpoch) return;
        this.#day(t.localDate).resting_hr_bpm = v;
        this.recordsParsed++;
        return;
      }
      case "HKQuantityTypeIdentifierBodyMass": {
        const t = parseAppleDate(startDate);
        const v = Number(value);
        if (!t || !Number.isFinite(v)) return void this.recordsSkipped++;
        if (t.epoch < this.cutoffEpoch) return;
        const d = this.#day(t.localDate);
        if (d._bodyMassEpoch == null || t.epoch >= d._bodyMassEpoch) {
          d.body_mass_kg = v;
          d._bodyMassEpoch = t.epoch;
        }
        this.recordsParsed++;
        return;
      }
      case "HKCategoryTypeIdentifierSleepAnalysis": {
        const st = parseAppleDate(startDate);
        const en = parseAppleDate(endDate);
        const stage = SLEEP_STAGE[value];
        if (!st || !en || !stage || en.epoch < st.epoch)
          return void this.recordsSkipped++;
        if (en.epoch < this.cutoffEpoch) return;
        if (stage === "inbed") return; // tracked-in-bed, not sleep
        this.sleepSegments.push({
          start: st.epoch,
          end: en.epoch,
          endLocalDate: en.localDate,
          stage,
        });
        this.recordsParsed++;
        return;
      }
      default:
      // other record types are out of scope, ignore silently
    }
  }

  finalize() {
    const segs = [...this.sleepSegments].sort((a, b) => a.start - b.start);
    const sessions = [];
    let cur = null;
    for (const s of segs) {
      if (cur && s.start - cur.end <= SESSION_GAP_MS) {
        cur.segments.push(s);
        cur.end = Math.max(cur.end, s.end);
      } else {
        cur = { end: s.end, segments: [s] };
        sessions.push(cur);
      }
    }

    for (const sess of sessions) {
      // A session belongs to the calendar day of its wake-up (end) time.
      const last = sess.segments.reduce((a, b) => (b.end >= a.end ? b : a));
      const d = this.#day(last.endLocalDate);
      d.sleep_sessions = (d.sleep_sessions ?? 0) + 1;
      for (const seg of sess.segments) {
        const min = (seg.end - seg.start) / 60000;
        const field = STAGE_FIELD[seg.stage];
        if (field) d[field] = (d[field] ?? 0) + min;
        if (seg.stage !== "awake")
          d.total_sleep_min = (d.total_sleep_min ?? 0) + min;
      }
    }

    const round = (v) => (v == null ? null : Math.round(v));
    return [...this.days.entries()]
      .map(([date, d]) => ({
        date,
        hrv_ms: d.hrv_ms ?? null,
        resting_hr_bpm: d.resting_hr_bpm ?? null,
        total_sleep_min: round(d.total_sleep_min),
        deep_sleep_min: round(d.deep_sleep_min),
        rem_sleep_min: round(d.rem_sleep_min),
        core_sleep_min: round(d.core_sleep_min),
        awake_min: round(d.awake_min),
        sleep_sessions: d.sleep_sessions ?? null,
        body_mass_kg: d.body_mass_kg ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
