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

output "ingest_url" {
  value       = "${aws_apigatewayv2_api.api.api_endpoint}/ingest"
  description = "Direct upload endpoint for the Health Auto Export REST API automation (POST, X-Auth-Token header)."
}

output "ingest_token" {
  value       = random_password.ingest_token.result
  sensitive   = true
  description = "X-Auth-Token header value for /ingest. Read with: terraform output -raw ingest_token"
}
