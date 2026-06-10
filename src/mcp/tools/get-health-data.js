import { queryDays } from "../../shared/dynamo.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 86400000;

function isoDate(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function validDate(s) {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export const getHealthData = {
  name: "get_health_data",
  description:
    "Get daily health metrics (HRV, resting heart rate, sleep stages, body mass, " +
    "body fat %, BMI, lean body mass) from the Apple Health pipeline. " +
    "Returns one row per calendar day. Missing metrics are null. Defaults to the last 30 days.",
  inputSchema: {
    type: "object",
    properties: {
      start_date: {
        type: "string",
        description: "Range start, YYYY-MM-DD (inclusive)",
      },
      end_date: {
        type: "string",
        description: "Range end, YYYY-MM-DD (inclusive, defaults to today)",
      },
      last_days: {
        type: "integer",
        minimum: 1,
        maximum: MAX_RANGE_DAYS,
        description: "Shortcut: the last N days (overrides start_date)",
      },
    },
    additionalProperties: false,
  },

  async handler(args = {}, ctx) {
    const today = isoDate(Date.now());
    let { start_date: start, end_date: end, last_days: lastDays } = args;

    if (end == null) end = today;
    if (lastDays != null) {
      if (!Number.isInteger(lastDays) || lastDays < 1 || lastDays > MAX_RANGE_DAYS)
        throw new Error(`last_days must be an integer 1..${MAX_RANGE_DAYS}`);
      start = isoDate(Date.parse(`${end}T00:00:00Z`) - (lastDays - 1) * DAY_MS);
    }
    if (start == null)
      start = isoDate(Date.parse(`${end}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);

    if (!validDate(start)) throw new Error(`Invalid start_date: ${start}`);
    if (!validDate(end)) throw new Error(`Invalid end_date: ${end}`);
    if (start > end) throw new Error("start_date must be <= end_date");

    const rangeDays =
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1;
    if (rangeDays > MAX_RANGE_DAYS)
      throw new Error(
        `Range too large (${rangeDays} days, max ${MAX_RANGE_DAYS}). Narrow the range.`
      );

    const items = await queryDays(ctx.ddb, ctx.tableName, start, end);
    const days = items
      .map(({ pk, sk, updated_at, ...rest }) => rest)
      .sort((a, b) => a.date.localeCompare(b.date));

    return { start_date: start, end_date: end, days_returned: days.length, days };
  },
};
