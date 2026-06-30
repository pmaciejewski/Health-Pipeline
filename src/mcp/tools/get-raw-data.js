import { queryRaw } from "../../shared/dynamo.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

// Valid metric values are the output field names from QTY_METRICS plus the two
// special-cased ones so users can use the same names as in get_health_data.
const KNOWN_METRICS = new Set([
  "hrv_ms", "resting_hr_bpm", "body_mass_kg", "body_fat_pct", "bmi",
  "lean_body_mass_kg", "exercise_min", "active_energy_kj", "basal_energy_kj",
  "stand_hours", "stand_min", "sleeping_wrist_temp_c", "blood_oxygen_pct",
  "environmental_audio_db", "headphone_audio_db", "flights_climbed",
  "physical_effort", "respiratory_rate_bpm", "step_count", "time_in_daylight_min",
  "vo2_max", "walking_running_km", "walking_hr_avg_bpm", "six_minute_walk_m",
  "stair_speed_up_ms", "stair_speed_down_ms", "walking_asymmetry_pct",
  "walking_double_support_pct", "walking_speed_kmh", "walking_step_length_cm",
  "heart_rate", "sleep_analysis",
]);

export const getRawData = {
  name: "get_raw_data",
  description:
    "Get raw intraday health measurements for a specific calendar day. " +
    "Returns individual time-stamped readings: per-interval heart rate " +
    "(min/max/avg per ~5-min window), per-minute step counts, per-measurement " +
    "HRV/SpO2/respiratory rate, and per-session sleep detail. " +
    "Use the metric parameter (same field names as get_health_data) to narrow " +
    "to one measurement type; omit it to get everything for the day. " +
    "For daily summaries use get_health_data instead.",
  inputSchema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "The day to query, YYYY-MM-DD",
      },
      metric: {
        type: "string",
        description:
          "Optional: filter to one metric. Use field names from get_health_data " +
          "(e.g. 'heart_rate', 'step_count', 'sleep_analysis', 'hrv_ms', " +
          "'respiratory_rate_bpm'). Omit for all metrics.",
      },
    },
    required: ["date"],
    additionalProperties: false,
  },

  async handler(args = {}, ctx) {
    const { date, metric } = args;
    if (!validDate(date)) throw new Error(`Invalid date: ${date}`);
    if (metric != null && !KNOWN_METRICS.has(metric))
      throw new Error(
        `Unknown metric '${metric}'. Use a field name from get_health_data ` +
        "(e.g. 'heart_rate', 'step_count', 'sleep_analysis')."
      );

    const items = await queryRaw(ctx.ddb, ctx.tableName, date, metric);
    const points = items
      .map(({ pk, sk, ...rest }) => rest)
      .sort((a, b) => a.epoch - b.epoch);

    return {
      date,
      metric: metric ?? null,
      points_returned: points.length,
      points,
    };
  },
};
