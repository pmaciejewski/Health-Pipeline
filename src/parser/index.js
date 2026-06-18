import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import unzipper from "unzipper";
import { extractRecords } from "./xml-stream.js";
import { Aggregator } from "./aggregator.js";
import { parseJsonExport } from "./json-metrics.js";
import { resolveFormat } from "./detect-format.js";
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

  const parsed = await parseBody(Body, key, cutoffEpoch);

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

const toBuffer = (chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

// Peek the first chunk to identify the format by content (the upload key's
// extension can lie), then route. JSON is read whole; XML/ZIP is streamed by
// replaying the peeked chunk ahead of the rest of the body.
async function parseBody(body, key, cutoffEpoch) {
  const iterator = body[Symbol.asyncIterator]();
  const first = await iterator.next();
  const firstChunk = first.done ? Buffer.alloc(0) : toBuffer(first.value);
  const format = resolveFormat(key, firstChunk);

  if (format === "json") {
    let text = firstChunk.toString("utf8");
    for (let n = await iterator.next(); !n.done; n = await iterator.next())
      text += toBuffer(n.value).toString("utf8");
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse JSON from ${key}: ${err.message}`);
    }
    return { format: "json", ...parseJsonExport(json, { cutoffEpoch }) };
  }

  const replay = new PassThrough();
  pump(iterator, firstChunk, replay);
  return parseXml(replay, key, cutoffEpoch, format === "zip");
}

// Re-emit the peeked chunk and drain the rest of the source into `out`,
// honouring backpressure so large XML exports stay constant-memory.
async function pump(iterator, firstChunk, out) {
  try {
    if (firstChunk.length && !out.write(firstChunk)) await once(out, "drain");
    for (let n = await iterator.next(); !n.done; n = await iterator.next())
      if (!out.write(toBuffer(n.value))) await once(out, "drain");
    out.end();
  } catch (err) {
    out.destroy(err);
  }
}

// Apple Health export.xml, either raw or inside the export ZIP.
async function parseXml(stream, key, cutoffEpoch, unzip) {
  const xmlStream = unzip ? stream.pipe(unzipper.ParseOne(/export\.xml$/i)) : stream;

  const agg = new Aggregator({ cutoffEpoch });
  let parseErrors;
  try {
    ({ parseErrors } = await extractRecords(xmlStream, (r) => agg.addRecord(r)));
  } catch (err) {
    throw new Error(`Failed to read export.xml from ${key}: ${err.message}`);
  }
  return {
    format: unzip ? "zip" : "xml",
    rows: agg.finalize(),
    recordsParsed: agg.recordsParsed,
    recordsSkipped: agg.recordsSkipped,
    parseErrors,
  };
}
