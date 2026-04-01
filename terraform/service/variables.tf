variable "vpc-name" {
  type    = string
  default = "internal-tools"
}

variable "aws-id" {
  type = string
}

variable "cluster-name" {
  type    = string
  default = "cluster01"
}

variable "container-registry" {
  type = string
}

variable "service-repo-prefix" {
  type    = string
  default = "service"
}

variable "service-repository" {
  type    = string
  default = ""
}

variable "service-version" {
  type    = string
  default = "main"
}

variable "desired-count" {
  type    = number
  default = 1
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "container-port" {
  type    = number
  default = 3333
}

variable "alb-listener-priority" {
  type    = number
  default = 240
}

variable "alb-deregistration-delay" {
  type    = number
  default = 30
}

variable "region" {
  type = string
}

variable "token" {
  type = string
}

variable "vpc-token" {
  type = string
}

variable "domain-suffix" {
  type = string
}

variable "is-prod" {
  type = bool
}

variable "super-admin-role" {
  type = string
}

variable "service-name" {
  type    = string
  default = "claudio"
}

variable "subnet-role" {
  type    = string
  default = "internal-default"
}

variable "network-mode" {
  type    = string
  default = "awsvpc"
}

variable "log-group-name" {
  type    = string
  default = ""
}

variable "log-retention-days" {
  type    = number
  default = 90
}

variable "enable-circuit-breaker" {
  type    = bool
  default = true
}

variable "circuit-breaker-rollback" {
  type    = bool
  default = true
}

variable "force-new-deployment" {
  type    = bool
  default = false
}

variable "enable-execute-command" {
  type    = bool
  default = false
}

variable "terraform-apply-role" {
  type    = string
  default = "jenkins-terraform-rw-role"
}

variable "frontend-url" {
  type    = string
  default = "https://claudio.int-tools.cmtelematics.com"
}

variable "capacity-provider-strategy" {
  type = list(object({
    capacity_provider = string
    base              = number
    weight            = number
  }))
  default = [
    {
      capacity_provider = "FARGATE_SPOT"
      base              = 0
      weight            = 99
    },
    {
      capacity_provider = "FARGATE"
      base              = 1
      weight            = 1
    }
  ]
}

variable "min-capacity" {
  type    = number
  default = 1
}

variable "max-capacity" {
  type    = number
  default = 2
}

variable "tf_repo_path" {
  type    = string
  default = ""
}
