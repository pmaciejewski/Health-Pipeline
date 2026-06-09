terraform {
  backend "s3" {
    bucket       = "health-pipeline-tfstate"
    key          = "health-pipeline/terraform.tfstate"
    region       = "eu-central-1"
    use_lockfile = true
  }
}
