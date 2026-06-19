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
  default     = 0
  description = "How many days back the parser processes from a cumulative Apple Health export. 0 (the default) means full history — no window. Set to a positive number to only keep the trailing N days."
}
