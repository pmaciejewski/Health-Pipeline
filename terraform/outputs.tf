output "api_endpoint" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "upload_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "mcp_url_template" {
  value       = "${aws_apigatewayv2_api.api.api_endpoint}/mcp/<TOKEN>"
  description = "Replace <TOKEN> with: aws secretsmanager get-secret-value --secret-id health-pipeline-auth-token --query SecretString --output text"
}
