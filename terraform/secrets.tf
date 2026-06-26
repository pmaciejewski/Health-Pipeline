# Capability-URL token: Claude custom connectors cannot send custom auth
# headers, so the MCP endpoint embeds this token as a path segment. It is
# delivered to the Lambda as an env var (encrypted at rest); the value also
# lives in Terraform state either way, so a secrets store would add cost
# without adding confidentiality.
# Rotate with: terraform apply -replace=random_password.auth_token
resource "random_password" "auth_token" {
  length  = 48
  special = false # path-segment safe
}

# Write-only token for the direct /ingest endpoint. Kept separate from
# auth_token so the value stored in the Health Auto Export app (and its iCloud
# backup) can only PUT transient exports — it grants no read access to health
# data via /mcp. Sent as the X-Auth-Token request header, not a URL segment, so
# it never lands in access logs or referrers.
# Rotate with: terraform apply -replace=random_password.ingest_token
resource "random_password" "ingest_token" {
  length  = 48
  special = false # header-value safe
}
