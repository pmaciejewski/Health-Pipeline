import {
  getSyncStatus as readSyncStatus,
  getDayBoundary,
  countDays,
} from "../../shared/dynamo.js";

export const getSyncStatus = {
  name: "get_sync_status",
  description:
    "Get the status of the last Apple Health sync: when it ran, how many days " +
    "were written, parse errors, plus overall data coverage (earliest/latest " +
    "day and total day count in the store).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },

  async handler(_args, ctx) {
    const [status, earliest, latest, totalDays] = await Promise.all([
      readSyncStatus(ctx.ddb, ctx.tableName),
      getDayBoundary(ctx.ddb, ctx.tableName, { latest: false }),
      getDayBoundary(ctx.ddb, ctx.tableName, { latest: true }),
      countDays(ctx.ddb, ctx.tableName),
    ]);

    if (!status && totalDays === 0) {
      return {
        synced: false,
        message:
          "No data yet. Upload an Apple Health export (request_upload_url) to start.",
      };
    }

    const { pk, sk, ...lastSync } = status ?? {};
    return {
      synced: true,
      last_sync: status ? lastSync : null,
      coverage: { earliest_day: earliest, latest_day: latest, total_days: totalDays },
    };
  },
};
