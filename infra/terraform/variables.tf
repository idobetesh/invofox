# Terraform Variables for Papertrail Invoice Bot

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

# Telegram Configuration
variable "telegram_bot_token" {
  description = "Telegram Bot Token from BotFather"
  type        = string
  sensitive   = true
}

variable "webhook_secret_path" {
  description = "Secret path component for webhook URL security"
  type        = string
  sensitive   = true
}

# OpenAI Configuration
variable "openai_api_key" {
  description = "OpenAI API Key"
  type        = string
  sensitive   = true
}

# Google Sheets Configuration
variable "sheet_id" {
  description = "Google Sheets spreadsheet ID for logging invoices"
  type        = string
}

# Cloud Run Configuration
variable "webhook_handler_image" {
  description = "Container image for webhook-handler service"
  type        = string
  default     = ""
}

variable "worker_image" {
  description = "Container image for worker service"
  type        = string
  default     = ""
}

variable "webhook_handler_memory" {
  description = "Memory allocation for webhook-handler (minimum 512Mi for Cloud Run)"
  type        = string
  default     = "512Mi"
}

variable "worker_memory" {
  description = "Memory allocation for worker"
  type        = string
  default     = "512Mi"
}

variable "worker_timeout" {
  description = "Timeout in seconds for worker requests"
  type        = number
  default     = 300
}

# Cloud Tasks Configuration
variable "queue_max_dispatches_per_second" {
  description = "Maximum task dispatches per second"
  type        = number
  default     = 5
}

variable "queue_max_concurrent_dispatches" {
  description = "Maximum concurrent task dispatches"
  type        = number
  default     = 10
}

variable "queue_max_attempts" {
  description = "Maximum retry attempts for failed tasks"
  type        = number
  default     = 6
}

variable "queue_min_backoff" {
  description = "Minimum backoff duration (e.g., '30s')"
  type        = string
  default     = "30s"
}

variable "queue_max_backoff" {
  description = "Maximum backoff duration (e.g., '1800s' for 30 minutes)"
  type        = string
  default     = "1800s"
}

# Budget Configuration
variable "billing_account_id" {
  description = "Billing account ID for budget alerts (optional, leave empty to skip budget creation)"
  type        = string
  default     = ""
}

variable "monthly_budget_amount" {
  description = "Monthly budget amount in your billing currency (alerts at 50%, 80%, 100%)"
  type        = number
  default     = 20
}

variable "budget_currency" {
  description = "Currency code for the budget (must match your billing account currency)"
  type        = string
  default     = "ILS"
}
