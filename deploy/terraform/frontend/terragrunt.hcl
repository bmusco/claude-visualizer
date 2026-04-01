# Source of truth for Claud-io static frontend (internal-tools).
# To apply: copy this folder to terraform-dev repo:
#   environments/internal-tools/cloudfront/claudio/
# Then open a PR and run the apply job.

include {
  path = find_in_parent_folders()
}

terraform {
  source = "git::ssh://${local.source-repo-url}//modules/cloudfront/custom-s3-backed-static-website?ref=${local.source-repo-ref}"
}

locals {
  environment-vars  = read_terragrunt_config(find_in_parent_folders("module-source.hcl"))
  override-repo-ref = "tf-v20251210.3"
  source-repo-ref   = coalesce(local.override-repo-ref, local.environment-vars.locals.source-repo-ref)
  source-repo-url   = local.environment-vars.locals.source-repo-url
}

inputs = {
  token                   = "int-tools"
  bucket-override-name     = "claudio-int-tools"
  website-domain          = "claudio.int-tools.cmtelematics.com"
  target-hosted-zone      = "int-tools.cmtelematics.com"
  target-acm-cert-domain  = "*.int-tools.cmtelematics.com"
  website-description     = "Claud-io — Claude Visualizer (internal tools)"
  region                  = "us-east-1"
  enable-waf              = true

  # SPA routing: serve index.html for all 404s
  custom-error-responses = [{
    error-code            = 403
    response-page-path    = "/index.html"
    response-code         = 200
    error-caching-min-ttl = 10
  }, {
    error-code            = 404
    response-page-path    = "/index.html"
    response-code         = 200
    error-caching-min-ttl = 10
  }]
}
