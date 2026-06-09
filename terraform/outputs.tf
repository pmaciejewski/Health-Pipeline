output "api_endpoint" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "upload_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "mcp_url" {
  value       = "${aws_apigatewayv2_api.api.api_endpoint}/mcp/${random_password.auth_token.result}"
  sensitive   = true
  description = "Full MCP connector URL. Read with: terraform output -raw mcp_url"
}
