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

export async function batchWriteDays(client, table, rows) {
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 25) {
    let requests = rows.slice(i, i + 25).map((r) => ({
      PutRequest: {
        Item: { pk: "DAY", sk: r.date, ...stripNulls(r), updated_at: updatedAt },
      },
    }));
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
