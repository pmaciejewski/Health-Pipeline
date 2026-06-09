data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# --- Parser Lambda ---

resource "aws_iam_role" "parser" {
  name               = "${var.project}-parser-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "parser" {
  statement {
    sid       = "ReadUploads"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/uploads/*"]
  }

  statement {
    sid       = "WriteData"
    actions   = ["dynamodb:PutItem", "dynamodb:BatchWriteItem"]
    resources = [aws_dynamodb_table.data.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.parser.arn}:*"]
  }
}

resource "aws_iam_role_policy" "parser" {
  name   = "parser"
  role   = aws_iam_role.parser.id
  policy = data.aws_iam_policy_document.parser.json
}

# --- MCP Lambda ---

resource "aws_iam_role" "mcp" {
  name               = "${var.project}-mcp-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "mcp" {
  statement {
    sid       = "ReadData"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.data.arn]
  }

  statement {
    sid       = "PresignUploads"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/uploads/*"]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.mcp.arn}:*"]
  }
}

resource "aws_iam_role_policy" "mcp" {
  name   = "mcp"
  role   = aws_iam_role.mcp.id
  policy = data.aws_iam_policy_document.mcp.json
}
