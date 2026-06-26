# Bundles are built by CI (npm run build) into dist/ before terraform runs.

data "archive_file" "parser" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/parser"
  output_path = "${path.module}/../dist/parser.zip"
}

data "archive_file" "mcp" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/mcp"
  output_path = "${path.module}/../dist/mcp.zip"
}

resource "aws_cloudwatch_log_group" "parser" {
  name              = "/aws/lambda/${var.project}-parser"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "mcp" {
  name              = "/aws/lambda/${var.project}-mcp"
  retention_in_days = 30
}

resource "aws_lambda_function" "parser" {
  function_name    = "${var.project}-parser"
  role             = aws_iam_role.parser.arn
  filename         = data.archive_file.parser.output_path
  source_code_hash = data.archive_file.parser.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 1024
  timeout          = 900

  environment {
    variables = {
      TABLE_NAME        = aws_dynamodb_table.data.name
      PARSE_WINDOW_DAYS = tostring(var.parse_window_days)
    }
  }

  depends_on = [aws_cloudwatch_log_group.parser]
}

resource "aws_lambda_function" "mcp" {
  function_name    = "${var.project}-mcp"
  role             = aws_iam_role.mcp.arn
  filename         = data.archive_file.mcp.output_path
  source_code_hash = data.archive_file.mcp.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 256
  timeout          = 29 # API Gateway integration ceiling is 30s

  environment {
    variables = {
      TABLE_NAME    = aws_dynamodb_table.data.name
      UPLOAD_BUCKET = aws_s3_bucket.uploads.bucket
      AUTH_TOKEN    = random_password.auth_token.result
      INGEST_TOKEN  = random_password.ingest_token.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.mcp]
}

resource "aws_lambda_permission" "s3_invoke_parser" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.parser.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.uploads.arn
}
