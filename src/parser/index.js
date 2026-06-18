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

// Read the whole S3 object and parse it as a Health Auto Export JSON document.
// The feed is day-aggregated and small, so streaming buys nothing here. The
// object key (extension) is ignored — whatever is uploaded is treated as JSON.
async function readJson(body, key) {
  let text = "";
  body.setEncoding("utf8");
  for await (const chunk of body) text += chunk;

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${key}: ${err.message}`);
  }
}
