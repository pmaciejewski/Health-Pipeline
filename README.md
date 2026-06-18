# Health-Pipeline

Serverless pipeline that turns Apple Health exports into Claude-queryable data.
Upload the export from your iPhone; a Lambda parses it into per-day health
metrics (HRV, resting HR, sleep stages, body mass) in DynamoDB; an MCP server
exposes the data to Claude on mobile.

Two upload formats are accepted, distinguished by file extension:

- **Apple Health export** — the `.zip` (or raw `export.xml`) from Health →
  *Export All Health Data*. Streamed and parsed as XML.
- **Health Auto Export (JSON)** — the `.json` feed from the
  [Health Auto Export](https://www.healthexportapp.com/) app. Already
  day-aggregated, so it also unlocks the extra metrics that app reports
  (steps, active/basal energy, heart-rate min/max/avg, blood oxygen,
  respiratory rate, VO2 max, walking/gait metrics, audio exposure, and more).

Both land in the same per-day DynamoDB rows and are served by the same MCP
tools — a field is simply absent on days no source reported it.

```
[iPhone: Health Sync Shortcut]
    │  GET /upload-url/<token>  →  pre-signed S3 URL
    │  PUT apple_health_export.zip
    ▼
┌──────────────────┐  S3 event   ┌─────────────────────────────┐
│ S3 uploads bucket│────────────▶│ Lambda: parser              │
│ (private, 7-day  │             │ streams ZIP → sax → per-day │
│  expiry)         │             │ aggregation                 │
└──────────────────┘             └──────────────┬──────────────┘
                                                ▼
                                        ┌───────────────┐
                                        │   DynamoDB    │
                                        │ pk=DAY sk=date│
                                        └───────┬───────┘
                                                │
                               ┌────────────────┴───────────────┐
                               │ Lambda: MCP server             │
                               │ API Gateway · token-in-URL auth│
                               └────────────────────────────────┘
                                                ▲
                                        MCP over HTTPS
                                        Claude (mobile)
```

## MCP tools

| Tool | Purpose |
|------|---------|
| `get_health_data` | Daily metric rows for a date range (default: last 30 days) |
| `request_upload_url` | Pre-signed S3 PUT URL for a fresh export |
| `get_sync_status` | Last sync result + data coverage |

## Repository layout

- `src/parser/` — S3-triggered Lambda: streaming XML parse (`xml-stream.js` +
  `aggregator.js`) or Health Auto Export JSON parse (`json-metrics.js`), both
  producing per-day rows
- `src/mcp/` — API Gateway Lambda: minimal stateless MCP server + upload-URL route
- `src/shared/` — DynamoDB access helpers
- `terraform/` — all infrastructure (S3, DynamoDB, Lambdas, API GW, IAM)
- `.github/workflows/` — CI (test/validate), plan-on-PR, apply-on-main
- `docs/` — [Claude connector setup](docs/claude-connector.md), [iOS Shortcut](docs/ios-shortcut.md)

## One-time setup

1. **AWS**: create the OIDC provider, deploy role and policy (scoped to
   `health-pipeline-*`), and the `health-pipeline-tfstate` state bucket.
2. **GitHub**: repo variable `AWS_DEPLOY_ROLE_ARN` = the deploy role ARN.
   Recommended: branch protection on `main` requiring the CI checks.
3. Merge to `main` → the Deploy workflow provisions everything.
4. Fetch the token, add the connector in Claude, build the iOS Shortcut
   (see `docs/`).

## Development

```bash
npm ci
npm test          # unit tests (node --test)
npm run build     # bundle Lambdas into dist/ (esbuild)
```

Infra changes go through PRs: the plan is posted as a PR comment; merging to
`main` applies it.

## Operational notes

- **Parse window**: the parser only processes the last 90 days of a (cumulative)
  export by default. For a one-off full-history backfill, set
  `parse_window_days = 0` in `terraform/variables.tf` via PR, re-upload the
  export, then revert.
- **Token rotation**: `terraform apply -replace=random_password.auth_token`,
  then update the Claude connector URL and the Shortcut.
- **Cost**: ~$0.15/month — S3 storage for transient uploads plus pennies of
  Lambda/DynamoDB; everything else sits in the free tier at single-user volumes.
