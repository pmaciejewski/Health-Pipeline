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
