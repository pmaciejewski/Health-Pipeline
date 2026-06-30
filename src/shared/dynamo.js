import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
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

export async function batchWriteDays(client, table, rows) {
  const updatedAt = new Date().toISOString();
  // Run up to 25 UpdateItem calls concurrently (matching the old batch size).
  // UpdateItem is used instead of BatchWrite PutItem so that each upload
  // only sets the fields present in that export; any fields already stored
  // from a prior upload are left intact. This prevents a partial daily export
  // (e.g. activity data only, no sleep) from overwriting metrics that were
  // written by an earlier upload for the same calendar day.
  for (let i = 0; i < rows.length; i += 25) {
    await Promise.all(
      rows.slice(i, i + 25).map((r) => upsertDay(client, table, r, updatedAt))
    );
  }
}

async function upsertDay(client, table, row, updatedAt) {
  const { date, ...rest } = stripNulls(row);
  const fields = Object.keys(rest);
  if (!fields.length) return;

  const names = { "#ua": "updated_at" };
  const values = { ":ua": updatedAt };
  const setParts = ["#ua = :ua"];
  fields.forEach((k, i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = rest[k];
    setParts.push(`#f${i} = :v${i}`);
  });

  let attempt = 0;
  for (;;) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk: "DAY", sk: date },
          UpdateExpression: `SET ${setParts.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );
      return;
    } catch (err) {
      if (++attempt > 5) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
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
