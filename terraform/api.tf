resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "mcp" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.mcp.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "mcp" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /mcp/{token}"
  target    = "integrations/${aws_apigatewayv2_integration.mcp.id}"
}

resource "aws_apigatewayv2_route" "upload_url" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /upload-url/{token}"
  target    = "integrations/${aws_apigatewayv2_integration.mcp.id}"
}

# Direct file ingest for the Health Auto Export app's REST API automation,
# which can only POST to a fixed URL. Auth is the X-Auth-Token header
# (ingest_token), checked in the Lambda. The body is written straight to S3,
# capped to stay under the Lambda payload limit — large backfills use the
# pre-signed /upload-url flow instead.
resource "aws_apigatewayv2_route" "ingest" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /ingest"
  target    = "integrations/${aws_apigatewayv2_integration.mcp.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # Single-user API: low limits blunt brute-force probing and runaway cost.
  default_route_settings {
    throttling_rate_limit  = 10
    throttling_burst_limit = 20
  }
}

resource "aws_lambda_permission" "apigw_invoke_mcp" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mcp.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
