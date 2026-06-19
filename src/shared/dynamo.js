import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  PutCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

export function createDocumentClient() {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function stripNulls(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null)
  );
}

// Write fully-formed items in chunks of 25, retrying any the service throttles.
async function batchWrite(client, table, items) {
  for (let i = 0; i < items.length; i += 25) {
    let requests = items
      .slice(i, i + 25)
      .map((Item) => ({ PutRequest: { Item } }));
    let attempt = 0;
    while (requests.length) {
      const res = await client.send(
        new BatchWriteCommand({ RequestItems: { [table]: requests } })
      );
      requests = res.UnprocessedItems?.[table] ?? [];
      if (!requests.length) break;
      if (++attempt > 5)
        throw new Error("DynamoDB batch write: unprocessed items after 5 retries");
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
}

export async function batchWriteDays(client, table, rows) {
  const updatedAt = new Date().toISOString();
  const items = rows.map((r) =>
    stripNulls({ pk: "DAY", sk: r.date, ...r, updated_at: updatedAt })
  );
  await batchWrite(client, table, items);
}

// Persist the raw import: one item per (day, metric) holding the original points.
// Keyed pk="RAW", sk="<date>#<metric>" so a date range is one Query, mirroring DAY.
export async function batchWriteRaw(client, table, rawRows) {
  const updatedAt = new Date().toISOString();
  const items = rawRows.map((r) =>
    stripNulls({
      pk: "RAW",
      sk: `${r.date}#${r.metric}`,
      date: r.date,
      metric: r.metric,
      units: r.units,
      points: r.points,
      updated_at: updatedAt,
    })
  );
  await batchWrite(client, table, items);
}

export async function writeSyncStatus(client, table, status) {
  await client.send(
    new PutCommand({
      TableName: table,
      Item: { pk: "SYNC", sk: "LATEST", ...status },
    })
  );
}

export async function getSyncStatus(client, table) {
  const res = await client.send(
    new GetCommand({ TableName: table, Key: { pk: "SYNC", sk: "LATEST" } })
  );
  return res.Item ?? null;
}

export async function queryDays(client, table, startDate, endDate) {
  const items = [];
  let lastKey;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p AND sk BETWEEN :a AND :b",
        ExpressionAttributeValues: { ":p": "DAY", ":a": startDate, ":b": endDate },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// Raw per-(day, metric) items across a date range, optionally one metric only.
export async function queryRaw(client, table, startDate, endDate, metric) {
  const items = [];
  let lastKey;
  // sk "<date>#" .. "<date>#￿" spans every metric on the end day inclusively.
  const values = { ":p": "RAW", ":a": `${startDate}#`, ":b": `${endDate}#￿` };
  const filter = metric ? "#m = :m" : undefined;
  const names = metric ? { "#m": "metric" } : undefined;
  if (metric) values[":m"] = metric;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p AND sk BETWEEN :a AND :b",
        FilterExpression: filter,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function getDayBoundary(client, table, { latest }) {
  const res = await client.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": "DAY" },
      ScanIndexForward: !latest,
      Limit: 1,
    })
  );
  return res.Items?.[0]?.sk ?? null;
}

export async function countDays(client, table) {
  let count = 0;
  let lastKey;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": "DAY" },
        Select: "COUNT",
        ExclusiveStartKey: lastKey,
      })
    );
    count += res.Count ?? 0;
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return count;
}
