import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { parseJsonExport } from "./json-metrics.js";
import {
  createDocumentClient,
  batchWriteDays,
  writeSyncStatus,
} from "../shared/dynamo.js";

const s3 = new S3Client({});
const ddb = createDocumentClient();
const TABLE = process.env.TABLE_NAME;
const WINDOW_DAYS = Number(process.env.PARSE_WINDOW_DAYS ?? "90");

export async function handler(event) {
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    await processObject(bucket, key);
  }
}

async function processObject(bucket, key) {
  const started = Date.now();
  console.log(JSON.stringify({ msg: "sync started", key }));

  const { Body } = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  const cutoffEpoch =
    WINDOW_DAYS > 0 ? Date.now() - WINDOW_DAYS * 86400000 : -Infinity;

  const json = await readJson(Body, key);
  const { rows, recordsParsed, recordsSkipped } = parseJsonExport(json, {
    cutoffEpoch,
  });

  if (rows.length) await batchWriteDays(ddb, TABLE, rows);

  const status = {
    last_sync_at: new Date().toISOString(),
    source_file: key,
    format: "json",
    days_written: rows.length,
    records_parsed: recordsParsed,
    records_skipped: recordsSkipped,
    window_days: WINDOW_DAYS,
    duration_ms: Date.now() - started,
  };
  await writeSyncStatus(ddb, TABLE, status);
  console.log(JSON.stringify({ msg: "sync complete", ...status }));
}

// Drain an S3 GetObject Body to a UTF-8 string. The AWS SDK exposes
// transformToString() on its stream blob; fall back to async iteration for
// plain Node readables (e.g. in tests). Buffer chunks are decoded explicitly so
// a multi-byte character split across chunks can never corrupt the text.
export async function bodyToString(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body.transformToString === "function")
    return body.transformToString("utf-8");

  const chunks = [];
  for await (const chunk of body)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

// Read the whole S3 object and parse it as a Health Auto Export JSON document.
// The feed is day-aggregated and small, so streaming buys nothing here. The
// object key (extension) is ignored — whatever is uploaded is treated as JSON.
export async function readJson(body, key) {
  const text = await bodyToString(body);
  if (!text.trim())
    throw new Error(
      `Empty object at ${key} — the upload has no body (re-run the upload)`
    );

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${key}: ${err.message}`);
  }
}
