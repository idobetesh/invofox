# Terraform Configuration for Papertrail Invoice Bot
# Provisions Cloud Run, Cloud Tasks, Firestore, and IAM resources

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

# Local values
locals {
  service_name_prefix = "papertrail"
  queue_name          = "invoice-processing"

  # Labels for all resources
  labels = {
    app         = "papertrail"
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ============================================================================
# Enable Required APIs
# ============================================================================

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "billingbudgets.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ============================================================================
# Artifact Registry for Container Images
# ============================================================================

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "${local.service_name_prefix}-containers"
  format        = "DOCKER"
  description   = "Container images for Papertrail Invoice Bot"
  labels        = local.labels

  depends_on = [google_project_service.apis]
}

# ============================================================================
# Firestore Database
# ============================================================================

resource "google_firestore_database" "main" {
  provider    = google-beta
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis]
}

# ============================================================================
# Cloud Storage Bucket (for invoice images)
# ============================================================================

resource "google_storage_bucket" "invoices" {
  name          = "${var.project_id}-invoices"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  # No lifecycle rules - manual deletion only

  labels = local.labels
}

# Make bucket publicly readable
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.invoices.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ============================================================================
# Service Accounts
# ============================================================================

# Webhook Handler Service Account
resource "google_service_account" "webhook_handler" {
  account_id   = "webhook-handler-sa"
  display_name = "Webhook Handler Service Account"
  description  = "Service account for webhook-handler Cloud Run service"
}

# Worker Service Account
resource "google_service_account" "worker" {
  account_id   = "worker-sa"
  display_name = "Worker Service Account"
  description  = "Service account for worker Cloud Run service"
}

# Cloud Tasks Invoker Service Account
resource "google_service_account" "tasks_invoker" {
  account_id   = "tasks-invoker-sa"
  display_name = "Cloud Tasks Invoker Service Account"
  description  = "Service account used by Cloud Tasks to invoke worker"
}

# ============================================================================
# Secret Manager Secrets
# ============================================================================

resource "google_secret_manager_secret" "telegram_bot_token" {
  secret_id = "TELEGRAM_BOT_TOKEN"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "telegram_bot_token" {
  secret      = google_secret_manager_secret.telegram_bot_token.id
  secret_data = var.telegram_bot_token
}

resource "google_secret_manager_secret" "openai_api_key" {
  secret_id = "OPENAI_API_KEY"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "openai_api_key" {
  secret      = google_secret_manager_secret.openai_api_key.id
  secret_data = var.openai_api_key
}

resource "google_secret_manager_secret" "webhook_secret_path" {
  secret_id = "WEBHOOK_SECRET_PATH"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "webhook_secret_path" {
  secret      = google_secret_manager_secret.webhook_secret_path.id
  secret_data = var.webhook_secret_path
}

resource "google_secret_manager_secret" "sheet_id" {
  secret_id = "SHEET_ID"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "sheet_id" {
  secret      = google_secret_manager_secret.sheet_id.id
  secret_data = var.sheet_id
}

# ============================================================================
# IAM Bindings
# ============================================================================

# Webhook handler can create Cloud Tasks
resource "google_project_iam_member" "webhook_tasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.webhook_handler.email}"
}

# Worker can access Firestore
resource "google_project_iam_member" "worker_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# Secret Manager access for webhook-handler
resource "google_secret_manager_secret_iam_member" "webhook_secret_access" {
  secret_id = google_secret_manager_secret.webhook_secret_path.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.webhook_handler.email}"
}

# Secret Manager access for worker
resource "google_secret_manager_secret_iam_member" "worker_telegram_token" {
  secret_id = google_secret_manager_secret.telegram_bot_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_openai_key" {
  secret_id = google_secret_manager_secret.openai_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# Worker can write to Cloud Storage bucket
resource "google_storage_bucket_iam_member" "worker_storage" {
  bucket = google_storage_bucket.invoices.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_sheet_id" {
  secret_id = google_secret_manager_secret.sheet_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# Allow webhook-handler to create tasks as tasks-invoker
resource "google_service_account_iam_member" "webhook_can_act_as_tasks_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.webhook_handler.email}"
}

# ============================================================================
# Cloud Tasks Queue
# ============================================================================

resource "google_cloud_tasks_queue" "invoice_processing" {
  name     = local.queue_name
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.queue_max_dispatches_per_second
    max_concurrent_dispatches = var.queue_max_concurrent_dispatches
  }

  retry_config {
    max_attempts       = var.queue_max_attempts
    min_backoff        = var.queue_min_backoff
    max_backoff        = var.queue_max_backoff
    max_doublings      = 5
    max_retry_duration = "0s" # No limit
  }

  depends_on = [google_project_service.apis]
}

# ============================================================================
# Cloud Run Services
# ============================================================================

# Webhook Handler Service
resource "google_cloud_run_v2_service" "webhook_handler" {
  name     = "webhook-handler"
  location = var.region

  template {
    service_account = google_service_account.webhook_handler.email

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    containers {
      image = var.webhook_handler_image != "" ? var.webhook_handler_image : "gcr.io/cloudrun/placeholder"

      resources {
        limits = {
          cpu    = "1"
          memory = var.webhook_handler_memory
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "GCP_LOCATION"
        value = var.region
      }

      env {
        name  = "QUEUE_NAME"
        value = local.queue_name
      }

      env {
        name  = "WORKER_URL"
        value = "https://worker-${data.google_project.current.number}.${var.region}.run.app"
      }

      env {
        name  = "SERVICE_ACCOUNT_EMAIL"
        value = google_service_account.tasks_invoker.email
      }

      env {
        name = "WEBHOOK_SECRET_PATH"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.webhook_secret_path.secret_id
            version = "latest"
          }
        }
      }

      ports {
        container_port = 8080
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = local.labels

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.webhook_secret_path,
  ]
}

# Worker Service
resource "google_cloud_run_v2_service" "worker" {
  name     = "worker"
  location = var.region

  template {
    service_account = google_service_account.worker.email
    timeout         = "${var.worker_timeout}s"

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.worker_image != "" ? var.worker_image : "gcr.io/cloudrun/placeholder"

      resources {
        limits = {
          cpu    = "2"
          memory = var.worker_memory
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "MAX_RETRIES"
        value = tostring(var.queue_max_attempts)
      }

      env {
        name = "TELEGRAM_BOT_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telegram_bot_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.openai_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "STORAGE_BUCKET"
        value = google_storage_bucket.invoices.name
      }

      env {
        name = "SHEET_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.sheet_id.secret_id
            version = "latest"
          }
        }
      }

      ports {
        container_port = 8080
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = local.labels

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.telegram_bot_token,
    google_secret_manager_secret_version.openai_api_key,
    google_secret_manager_secret_version.sheet_id,
    google_storage_bucket.invoices,
  ]
}

# Data source for project number (used in Cloud Run URL)
data "google_project" "current" {}

# Allow unauthenticated access to webhook-handler (Telegram needs this)
resource "google_cloud_run_v2_service_iam_member" "webhook_public" {
  location = var.region
  name     = google_cloud_run_v2_service.webhook_handler.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Allow tasks-invoker-sa to invoke worker
resource "google_cloud_run_v2_service_iam_member" "worker_tasks_invoker" {
  location = var.region
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks_invoker.email}"
}

# ============================================================================
# Budget Alert (Cost Protection)
# ============================================================================

data "google_billing_account" "account" {
  provider        = google-beta
  count           = var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
}

resource "google_billing_budget" "monthly_budget" {
  provider = google-beta
  count    = var.billing_account_id != "" ? 1 : 0

  billing_account = var.billing_account_id
  display_name    = "Papertrail Monthly Budget"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget_amount)
    }
  }

  # Alert at 50%, 80%, and 100% of budget
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  # Send alerts to billing account admins
  all_updates_rule {
    monitoring_notification_channels = []
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.apis["billingbudgets.googleapis.com"]]
}
