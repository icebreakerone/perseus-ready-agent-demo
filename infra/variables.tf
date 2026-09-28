variable "name" {
  description = "Prefix for resource names and the Project tag."
  type        = string
  default     = "perseusready"
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "domain_name" {
  description = "Public hostname of the demo."
  type        = string
  default     = "perseusready.sandbox.demo.ib1.org"
}

variable "hosted_zone_id" {
  description = "Route 53 zone the hostname lives in (demo.ib1.org)."
  type        = string
  default     = "Z06714251ECA7V1H5RJYT"
}

variable "vpc_cidr" {
  type    = string
  default = "10.60.0.0/16"
}

variable "image_tag" {
  description = "Tag of the web image in ECR, set by scripts/deploy.sh."
  type        = string
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "enable_execute_command" {
  description = "Allow `aws ecs execute-command` into the running task for debugging."
  type        = bool
  default     = true
}

# Perseus sandbox identifiers and endpoints. These mirror .env.example; every
# URL is a variable so the stack can move to production.
variable "app_config" {
  description = "Non-secret app configuration passed to the web container as environment variables."
  type        = map(string)
  default = {
    DIRECTORY_URL              = "https://directory.core.sandbox.trust.ib1.org"
    REGISTRY_URL               = "https://registry.core.sandbox.trust.ib1.org"
    CAP_MEMBER_ID              = "4tnapijm"
    CAP_APPLICATION_ID         = "ciro1gll"
    EDP_MEMBER_ID              = "7a1qv915"
    FSP_MEMBER_URL             = "https://directory.core.sandbox.trust.ib1.org/m/3vbfb8c1"
    EDP_RESOURCE_BASE_OVERRIDE = "https://mtls.perseus-demo-energy.ib1.org"
    # The demo SME's account with us (the CAP). Not an IB1 credential.
    DEMO_SME_USERNAME = "demo"
    DEMO_SME_PASSWORD = "perseus"
    DEMO_SME_NAME     = "Acme Bakery Ltd"
    DEMO_SME_ID       = "SME-000123"
  }
}
