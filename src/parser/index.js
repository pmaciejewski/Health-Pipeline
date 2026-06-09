import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import unzipper from "unzipper";
import { extractRecords } from "./xml-stream.js";
import { Aggregator } from "./aggregator.js";
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

  let xmlStream;
  if (key.toLowerCase().endsWith(".xml")) {
    xmlStream = Body;
  } else {
    xmlStream = Body.pipe(unzipper.ParseOne(/export\.xml$/i));
  }

  const cutoffEpoch =
    WINDOW_DAYS > 0 ? Date.now() - WINDOW_DAYS * 86400000 : -Infinity;
  const agg = new Aggregator({ cutoffEpoch });

  let parseErrors;
  try {
    ({ parseErrors } = await extractRecords(xmlStream, (r) =>
      agg.addRecord(r)
    ));
  } catch (err) {
    throw new Error(
      `Failed to read export.xml from ${key}: ${err.message}`
    );
  }

  const rows = agg.finalize();
  if (rows.length) await batchWriteDays(ddb, TABLE, rows);

  const status = {
    last_sync_at: new Date().toISOString(),
    source_file: key,
    days_written: rows.length,
    records_parsed: agg.recordsParsed,
    records_skipped: agg.recordsSkipped,
    xml_parse_errors: parseErrors,
    window_days: WINDOW_DAYS,
    duration_ms: Date.now() - started,
  };
  await writeSyncStatus(ddb, TABLE, status);
  console.log(JSON.stringify({ msg: "sync complete", ...status }));
}
