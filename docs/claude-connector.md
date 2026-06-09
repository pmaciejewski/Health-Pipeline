# Connecting the MCP server to Claude

Requires a Claude plan with custom connector support (Pro/Max/Team).

## 1. Get your MCP URL

After the first successful deploy:

```bash
cd terraform && terraform init && terraform output mcp_url
```

The URL looks like:
```
https://<api-id>.execute-api.eu-central-1.amazonaws.com/mcp
```

## 2. Add the connector

1. Claude (web or mobile) → **Settings** → **Connectors** → **Add custom connector**
2. Name: `Health Pipeline`
3. URL: the `/mcp` URL above — **no token, no trailing slash**
4. Leave OAuth Client ID and OAuth Client Secret **blank** — the OAuth flow runs automatically when you add the connector; Claude will redirect you through it once, then it's done
5. Click **Add** and follow the OAuth prompt

Claude discovers the auth server automatically, completes the PKCE flow, and stores the bearer token. You don't need to handle the token yourself.

## 3. Use it

- *"How has my HRV trended over the last two weeks?"*
- *"Compare my deep sleep on training vs rest days."*
- *"Give me an upload link for a fresh health export."*
- *"When did I last sync and how many days of data do I have?"*

## 4. iOS Shortcut — get the bearer token

The Shortcut needs the token to call the upload-url endpoint. Fetch it once after deploy:

```bash
cd terraform && terraform output -raw auth_token
```

Store it in the Shortcut as a text variable (see `ios-shortcut.md`).

## 5. Token rotation

```bash
terraform apply -replace=random_password.auth_token
```

This regenerates the token and redeploys the Lambda in one step. Afterwards:
- Re-add the Claude connector (the OAuth token stored by Claude will be stale)
- Update the token in the iOS Shortcut
