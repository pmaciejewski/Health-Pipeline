# Connecting the MCP server to Claude

Requires a Claude plan with custom connector support (Pro/Max/Team).

## 1. Get your MCP URL

After the first successful deploy:

```bash
# API endpoint (also shown as a terraform output / in the deploy job log)
aws apigatewayv2 get-apis \
  --query "Items[?Name=='health-pipeline-api'].ApiEndpoint" --output text

# Auth token
aws secretsmanager get-secret-value \
  --secret-id health-pipeline-auth-token \
  --query SecretString --output text
```

Your MCP URL is:

```
<api-endpoint>/mcp/<token>
```

## 2. Add the connector

1. Claude (web or mobile) → **Settings** → **Connectors** → **Add custom connector**.
2. Name: `Health Pipeline`. URL: the MCP URL above. No OAuth — leave auth empty
   (the token in the URL is the auth).
3. Save. The three tools appear: `get_health_data`, `request_upload_url`,
   `get_sync_status`.

## 3. Use it

- *"How has my HRV trended over the last two weeks?"*
- *"Compare my deep sleep on training vs rest days."* (combine with Motra data)
- *"Give me an upload link for a fresh health export."*
- *"When did I last sync and how many days of data do I have?"*

## Token rotation

The URL embeds the auth token, so treat the URL itself as a secret. To rotate:

```bash
# in a checkout with terraform access, or via a one-line PR
terraform apply -replace=random_password.auth_token
```

Then update the connector URL in Claude and the iOS Shortcut.
