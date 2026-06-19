// Shared date-range resolution for the read tools. Accepts {start_date,
// end_date, last_days} and returns a validated, bounded {start, end} pair.
// end defaults to today; last_days (or a default span) backfills start.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

export function isoDate(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function validDate(s) {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function resolveRange(args = {}, { maxRangeDays, defaultRangeDays }) {
  const today = isoDate(Date.now());
  let { start_date: start, end_date: end, last_days: lastDays } = args;

  if (end == null) end = today;
  if (lastDays != null) {
    if (!Number.isInteger(lastDays) || lastDays < 1 || lastDays > maxRangeDays)
      throw new Error(`last_days must be an integer 1..${maxRangeDays}`);
    start = isoDate(Date.parse(`${end}T00:00:00Z`) - (lastDays - 1) * DAY_MS);
  }
  if (start == null)
    start = isoDate(Date.parse(`${end}T00:00:00Z`) - (defaultRangeDays - 1) * DAY_MS);

  if (!validDate(start)) throw new Error(`Invalid start_date: ${start}`);
  if (!validDate(end)) throw new Error(`Invalid end_date: ${end}`);
  if (start > end) throw new Error("start_date must be <= end_date");

  const rangeDays =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1;
  if (rangeDays > maxRangeDays)
    throw new Error(
      `Range too large (${rangeDays} days, max ${maxRangeDays}). Narrow the range.`
    );

  return { start, end };
}
