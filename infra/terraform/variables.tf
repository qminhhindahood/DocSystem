variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Single region for the production pilot."
  type        = string
  default     = "asia-southeast1"
  validation {
    condition     = var.region == "asia-southeast1"
    error_message = "The approved pilot region is asia-southeast1."
  }
}

variable "github_owner" {
  description = "GitHub account that owns the production repository."
  type        = string
}

variable "github_repository" {
  description = "Exact GitHub repository name."
  type        = string
  default     = "DocAI"
}

variable "production_branch" {
  description = "Only this branch may federate as the production deployer."
  type        = string
  default     = "master"
}

variable "billing_account_id" {
  description = "Billing account used for the trial-credit budget."
  type        = string
  default     = "01CC42-D509AB-1F4CB9"
}

variable "image_tag" {
  description = "Immutable Git commit SHA used for every initial image."
  type        = string
  validation {
    condition     = var.image_tag != "latest" && can(regex("^[a-f0-9]{7,40}$", var.image_tag))
    error_message = "image_tag must be an immutable 7-40 character lowercase Git SHA, never latest."
  }
}

variable "notification_email" {
  description = "Operator email address for Monitoring and budget alerts; empty disables creation."
  type        = string
  default     = ""
}

variable "notification_channel_ids" {
  description = "Additional full Cloud Monitoring notification-channel resource IDs."
  type        = list(string)
  default     = []
}

variable "operator_email" {
  description = "Human operator allowed to invoke the break-glass password reset job."
  type        = string
  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.operator_email))
    error_message = "operator_email must be a valid email address."
  }
}

variable "public_frontend_origin" {
  description = "HTTPS frontend origin used for CORS and reset links. Use a provisional HTTPS origin on the first apply, then set the emitted frontend_url and reapply."
  type        = string
  default     = "https://bootstrap.invalid"
  validation {
    condition     = startswith(var.public_frontend_origin, "https://") && !endswith(var.public_frontend_origin, "/")
    error_message = "public_frontend_origin must be an HTTPS origin without a trailing slash."
  }
}

variable "public_frontend_fallback_origins" {
  description = "Additional HTTPS frontend origins retained during a custom-domain transition."
  type        = list(string)
  default     = []
  validation {
    condition = alltrue([
      for origin in var.public_frontend_fallback_origins :
      startswith(origin, "https://") && !endswith(origin, "/")
    ])
    error_message = "public_frontend_fallback_origins must contain HTTPS origins without trailing slashes."
  }
}

variable "turnstile_site_key" {
  description = "Public Cloudflare Turnstile site key rendered by the signup page."
  type        = string
  validation {
    condition     = length(trimspace(var.turnstile_site_key)) >= 10
    error_message = "turnstile_site_key must be a non-empty Cloudflare site key."
  }
}

variable "secret_versions" {
  description = "Explicit Secret Manager versions referenced by services and jobs."
  type        = map(string)
  default = {
    jwt-secret                = "1"
    llm-config-encryption-key = "1"
    renderer-internal-token   = "1"
    redis-url                 = "1"
    jina-api-key              = "1"
    bootstrap-username        = "1"
    bootstrap-email           = "1"
    bootstrap-password        = "1"
    smoke-username            = "1"
    smoke-password            = "1"
    turnstile-secret-key      = "2"
  }
}
