# Capability-URL token: Claude custom connectors cannot send custom auth
# headers, so the MCP endpoint embeds this token as a path segment.
# Rotate with: terraform apply -replace=random_password.auth_token
resource "random_password" "auth_token" {
  length  = 48
  special = false # path-segment safe
}

resource "aws_secretsmanager_secret" "auth_token" {
  name                    = "${var.project}-auth-token"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "auth_token" {
  secret_id     = aws_secretsmanager_secret.auth_token.id
  secret_string = random_password.auth_token.result
}
