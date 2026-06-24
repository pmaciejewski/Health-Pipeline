# Automated exports: direct REST API ingest

The fully hands-off path. The [Health Auto Export](https://www.healthexportapp.com/)
app POSTs your health JSON straight to the pipeline's `/ingest` endpoint on a
schedule — no iOS Shortcut, no Share Sheet, no two-step pre-signed URL. This is
the recommended setup for daily syncing.

For the manual / one-tap path, or for large full-history backfills, use the
[iOS Shortcut](ios-shortcut.md) instead (see [When to use which](#when-to-use-which)).

## How it works

```
[Health Auto Export automation]
   │  POST <api>/ingest
   │  header: X-Auth-Token: <ingest token>
   │  body:   { "data": { "metrics": [...] } }   (JSON)
   ▼
Lambda  →  writes body to s3://…/uploads/  →  S3 event  →  parser  →  DynamoDB
```

The `/ingest` route is authenticated by the **`X-Auth-Token` header**, carrying a
**separate `ingest_token`** — distinct from the MCP connector token. That token
lives in the app on your phone (and its iCloud backup); keeping it write-only
means a leak can only push transient exports, never read your health data.

## 1. Get your endpoint and token

From a checkout with Terraform state access:

```bash
cd terraform && terraform init
terraform output -raw ingest_url     # e.g. https://<api-id>.execute-api.eu-central-1.amazonaws.com/ingest
terraform output -raw ingest_token   # the X-Auth-Token value — treat as a secret
```

Without Terraform:

```bash
aws apigatewayv2 get-apis \
  --query "Items[?Name=='health-pipeline-api'].ApiEndpoint" --output text   # append /ingest

aws lambda get-function-configuration \
  --function-name health-pipeline-mcp \
  --query 'Environment.Variables.INGEST_TOKEN' --output text
```

## 2. Configure the automation in the app

> **Note:** Health Auto Export has no "import automation from a file" feature —
> REST API automations are entered by hand (the config is only ever stored in
> encrypted iCloud backups). [`health-auto-export-automation.json`](health-auto-export-automation.json)
> in this folder is a **config reference** that mirrors every field below so you
> can transcribe it quickly; it is not something the app reads.

In **Health Auto Export** → **Automations** → **+**:

| Field | Value |
|---|---|
| **Automation Name** | `Health Pipeline` |
| **Automation type** | **REST API** |
| **URL** | `<api-endpoint>/ingest` |
| **HTTP Headers** | Add one: key `X-Auth-Token`, value = your `ingest_token` |
| **Data Type** | **Health Metrics** |
| **Select Health Metrics** | The metrics this pipeline parses (HRV, Resting Heart Rate, Heart Rate, Sleep Analysis, Body Mass, Steps, Active/Basal Energy, Blood Oxygen, Respiratory Rate, VO2 Max, walking/gait, audio exposure, …). Over-selecting is harmless — unknown metrics are ignored. |
| **Export Format** | **JSON** |
| **Summarize Data** | **ON** — one aggregated point per metric per day, which is exactly what the parser maps to a per-day row |
| **Date Range** | **Since Last Sync** (or **Default**) |
| **Batch Requests** | **OFF** — keep the export as a single request |
| **Sync Cadence** | e.g. every **1 day** |

The app sets `Content-Type: application/json` automatically for JSON exports.

## 3. Verify

Trigger the automation once (the app has a **Run** / manual-trigger control), then
ask Claude: *"What's my sync status?"* (the `get_sync_status` tool). Parsing runs
within a minute or two of the POST.

## When to use which

| | Direct `/ingest` (this doc) | [iOS Shortcut](ios-shortcut.md) |
|---|---|---|
| Trigger | App automation, scheduled | Share Sheet / Personal Automation |
| Hands-off | ✅ fully automatic | One tap (or a Personal Automation wrapper) |
| Auth | `X-Auth-Token` header, write-only token | URL path token, two-step pre-signed PUT |
| Max payload | ~5 MB (Lambda limit) | Large — straight to S3 |
| Best for | Daily incremental sync | Manual upload, **full-history backfill** |

For a one-off full-history backfill (`parse_window_days = 0`, see the README),
prefer the Shortcut/pre-signed flow — a multi-year export can exceed the direct
endpoint's ~5 MB cap, which returns HTTP `413`.

## Security notes

- The `ingest_token` is **write-only**: it is rejected on `/mcp` and `/upload-url`,
  so it grants no access to your stored health data.
- Auth failures return **404**, indistinguishable from a nonexistent route.
- Rotate the token independently of the connector token:

  ```bash
  terraform apply -replace=random_password.ingest_token
  ```

  Then update the `X-Auth-Token` header in the app's automation.
