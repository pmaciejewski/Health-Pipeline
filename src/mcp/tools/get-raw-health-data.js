import { queryRaw } from "../../shared/dynamo.js";
import { resolveRange } from "../date-range.js";

// Raw data is far bulkier than the daily rollups (many points per metric per
// day), so the range is capped tighter — narrow with `metric` or fewer days.
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS = 7;

export const getRawHealthData = {
  name: "get_raw_health_data",
  description:
    "Get the raw, un-aggregated Apple Health points exactly as imported, before " +
    "they are rolled up into daily metrics. Each item is one metric for one " +
    "calendar day with its original data points (timestamp, value/qty or " +
    "min/max/avg, source). Includes metrics not present in the daily summary. " +
    "Use get_health_data for daily summaries; use this when you need the " +
    "underlying samples (e.g. intraday trends). Defaults to the last 7 days; " +
    `range capped at ${MAX_RANGE_DAYS} days — pass \`metric\` to narrow it.`,
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
      metric: {
        type: "string",
        description:
          "Optional: only this metric's points (e.g. step_count, heart_rate, sleep_analysis)",
      },
    },
    additionalProperties: false,
  },

  async handler(args = {}, ctx) {
    const { start, end } = resolveRange(args, {
      maxRangeDays: MAX_RANGE_DAYS,
      defaultRangeDays: DEFAULT_RANGE_DAYS,
    });
    const metric = args.metric ?? null;

    const items = await queryRaw(ctx.ddb, ctx.tableName, start, end, metric);
    const raw = items
      .map(({ pk, sk, updated_at, ...rest }) => rest)
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric)
      );

    return {
      start_date: start,
      end_date: end,
      metric,
      items_returned: raw.length,
      raw,
    };
  },
};
