variable "aws_region" {
  type    = string
  default = "eu-central-1"
}

variable "project" {
  type    = string
  default = "health-pipeline"
}

variable "parse_window_days" {
  type        = number
  default     = 90
  description = "How many days back the parser processes from a cumulative Apple Health export. Set to 0 for full history (one-off backfill), then revert."
}
