output "api_endpoint" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "upload_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "mcp_url" {
  value       = "${aws_apigatewayv2_api.api.api_endpoint}/mcp"
  description = "Enter this URL in Claude Settings → Connectors. OAuth is handled automatically."
}

output "auth_token" {
  value       = random_password.auth_token.result
  sensitive   = true
  description = "Bearer token for the iOS Shortcut. Read with: terraform output -raw auth_token"
}
