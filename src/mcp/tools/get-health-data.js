import { queryDays } from "../../shared/dynamo.js";
import { resolveRange } from "../date-range.js";

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;

export const getHealthData = {
  name: "get_health_data",
  description:
    "Get daily health metrics from the Apple Health pipeline. Returns one row " +
    "per calendar day. Metrics include: HRV, resting/walking/min/max/avg heart " +
    "rate, sleep stages, body mass, body fat %, BMI, lean body mass, steps, " +
    "active & basal energy, exercise & stand minutes, blood oxygen, respiratory " +
    "rate, VO2 max, walking/running distance and gait metrics, audio exposure, " +
    "and more. A field is absent for a day when no source reported it. " +
    "Defaults to the last 30 days.",
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
    const { start, end } = resolveRange(args, {
      maxRangeDays: MAX_RANGE_DAYS,
      defaultRangeDays: DEFAULT_RANGE_DAYS,
    });

    const items = await queryDays(ctx.ddb, ctx.tableName, start, end);
    const days = items
      .map(({ pk, sk, updated_at, ...rest }) => rest)
      .sort((a, b) => a.date.localeCompare(b.date));

    return { start_date: start, end_date: end, days_returned: days.length, days };
  },
};
