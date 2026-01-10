# Terraform Outputs for Papertrail Invoice Bot

output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP Region"
  value       = var.region
}

# Cloud Run URLs
output "webhook_handler_url" {
  description = "URL of the webhook-handler Cloud Run service"
  value       = google_cloud_run_v2_service.webhook_handler.uri
}

output "worker_url" {
  description = "URL of the worker Cloud Run service"
  value       = google_cloud_run_v2_service.worker.uri
}

output "webhook_full_url" {
  description = "Full webhook URL to set with Telegram (includes secret path)"
  value       = "${google_cloud_run_v2_service.webhook_handler.uri}/webhook/${var.webhook_secret_path}"
  sensitive   = true
}

# Service Accounts
output "webhook_handler_service_account" {
  description = "Service account email for webhook-handler"
  value       = google_service_account.webhook_handler.email
}

output "worker_service_account" {
  description = "Service account email for worker"
  value       = google_service_account.worker.email
}

output "tasks_invoker_service_account" {
  description = "Service account email for Cloud Tasks invoker"
  value       = google_service_account.tasks_invoker.email
}

# Cloud Tasks
output "queue_name" {
  description = "Name of the Cloud Tasks queue"
  value       = google_cloud_tasks_queue.invoice_processing.name
}

output "queue_id" {
  description = "Full ID of the Cloud Tasks queue"
  value       = google_cloud_tasks_queue.invoice_processing.id
}

# Artifact Registry
output "artifact_registry_repository" {
  description = "Artifact Registry repository for container images"
  value       = google_artifact_registry_repository.containers.name
}

output "artifact_registry_url" {
  description = "URL for pushing container images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}"
}

# Firestore
output "firestore_database" {
  description = "Firestore database name"
  value       = google_firestore_database.main.name
}

# Instructions
output "next_steps" {
  description = "Next steps after terraform apply"
  value       = <<-EOT
    
    ========================================
    NEXT STEPS
    ========================================
    
    1. Build and push container images:
       
       # Webhook Handler
       cd services/webhook-handler
       docker build -t ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}/webhook-handler:latest .
       docker push ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}/webhook-handler:latest
       
       # Worker
       cd services/worker
       docker build -t ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}/worker:latest .
       docker push ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}/worker:latest
    
    2. Update Terraform with image URLs and re-apply:
       
       terraform apply -var="webhook_handler_image=${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}/webhook-handler:latest" -var="worker_image=${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.name}/worker:latest"
    
    3. Set Telegram webhook:
       
       curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
         -H "Content-Type: application/json" \
         -d '{"url": "${google_cloud_run_v2_service.webhook_handler.uri}/webhook/<YOUR_WEBHOOK_SECRET>"}'
    
    4. Share Google Sheet with worker service account:
       - Google Sheet: Share with ${google_service_account.worker.email} (Editor access)
    
    5. Test by sending a photo to your Telegram group!
    
    ========================================
  EOT
}
