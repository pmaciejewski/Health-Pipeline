# Health-Pipeline

Serverless pipeline that turns Apple Health data into Claude-queryable form.
Upload the [Health Auto Export](https://www.healthexportapp.com/) JSON feed
from your iPhone; a Lambda parses it into per-day health metrics (HRV, resting
HR, sleep stages, body mass, steps, energy, heart-rate min/max/avg, blood
oxygen, respiratory rate, VO2 max, walking/gait metrics, audio exposure, and
more) in DynamoDB; an MCP server exposes the data to Claude on mobile.

The parser folds every point that lands on the same calendar day into a per-day
DynamoDB row using each metric's natural daily aggregation (cumulative totals
sum; rates average; heart rate keeps the day's min/max/mean), so both
daily-granularity and hourly exports import correctly — a field is simply absent
on days no source reported it. Alongside the daily rollups it also stores the
raw, un-aggregated points exactly as imported (`pk=RAW`), so the underlying
samples stay queryable. Whatever is PUT to the upload URL is parsed as JSON
regardless of the object key's extension.

```
[iPhone: Health Auto Export app]
    │  GET /upload-url/<token>  →  pre-signed S3 URL
    │  PUT health-export.json
    ▼
┌──────────────────┐  S3 event   ┌─────────────────────────────┐
│ S3 uploads bucket│────────────▶│ Lambda: parser              │
│ (private, 7-day  │             │ JSON → per-day aggregation  │
│  expiry)         │             │       + raw points          │
└──────────────────┘             └──────────────┬──────────────┘
                                                ▼
                                        ┌────────────────────┐
                                        │      DynamoDB      │
                                        │ pk=DAY  sk=date    │
                                        │ pk=RAW  sk=date#m  │
                                        └─────────┬──────────┘
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
| `get_raw_health_data` | Raw, un-aggregated import points for a date range (default: last 7 days, max 31) |
| `request_upload_url` | Pre-signed S3 PUT URL for a fresh export |
| `get_sync_status` | Last sync result + data coverage |

## Repository layout

- `src/parser/` — S3-triggered Lambda: Health Auto Export JSON parse
  (`json-metrics.js`) into per-day rows
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

- **Parse window**: by default the parser keeps the full history of every
  export (`parse_window_days = 0`). To cap storage to a trailing window instead,
  set `parse_window_days` to a positive number in `terraform/variables.tf` via
  PR; points older than that many days are then dropped on import.
- **Token rotation**: `terraform apply -replace=random_password.auth_token`,
  then update the Claude connector URL and the Shortcut.
- **Cost**: ~$0.15/month — S3 storage for transient uploads plus pennies of
  Lambda/DynamoDB; everything else sits in the free tier at single-user volumes.
