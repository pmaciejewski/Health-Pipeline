import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import unzipper from "unzipper";
import { extractRecords } from "./xml-stream.js";
import { Aggregator } from "./aggregator.js";
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

  const parsed = key.toLowerCase().endsWith(".json")
    ? await parseJson(Body, key, cutoffEpoch)
    : await parseXml(Body, key, cutoffEpoch);

  const rows = parsed.rows;
  if (rows.length) await batchWriteDays(ddb, TABLE, rows);

  const status = {
    last_sync_at: new Date().toISOString(),
    source_file: key,
    format: parsed.format,
    days_written: rows.length,
    records_parsed: parsed.recordsParsed,
    records_skipped: parsed.recordsSkipped,
    xml_parse_errors: parsed.parseErrors ?? null,
    window_days: WINDOW_DAYS,
    duration_ms: Date.now() - started,
  };
  await writeSyncStatus(ddb, TABLE, status);
  console.log(JSON.stringify({ msg: "sync complete", ...status }));
}

// Apple Health export.xml, either raw or inside the export ZIP.
async function parseXml(body, key, cutoffEpoch) {
  const xmlStream = key.toLowerCase().endsWith(".xml")
    ? body
    : body.pipe(unzipper.ParseOne(/export\.xml$/i));

  const agg = new Aggregator({ cutoffEpoch });
  let parseErrors;
  try {
    ({ parseErrors } = await extractRecords(xmlStream, (r) => agg.addRecord(r)));
  } catch (err) {
    throw new Error(`Failed to read export.xml from ${key}: ${err.message}`);
  }
  return {
    format: "xml",
    rows: agg.finalize(),
    recordsParsed: agg.recordsParsed,
    recordsSkipped: agg.recordsSkipped,
    parseErrors,
  };
}

// "Health Auto Export" JSON feed: small, day-aggregated, read whole then parse.
async function parseJson(body, key, cutoffEpoch) {
  let text = "";
  body.setEncoding("utf8");
  for await (const chunk of body) text += chunk;

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${key}: ${err.message}`);
  }
  return { format: "json", ...parseJsonExport(json, { cutoffEpoch }) };
}
