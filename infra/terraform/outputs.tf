output "cloud_run_url" {
  description = "Public URL of Cruzo API service"
  value       = google_cloud_run_v2_service.api.uri
}

output "artifact_registry_repository" {
  description = "Docker repository"
  value       = google_artifact_registry_repository.cruzo.id
}

output "runtime_service_account" {
  description = "Service account used by Cloud Run"
  value       = google_service_account.run_runtime.email
}

output "database_url" {
  description = "Resolved DATABASE_URL passed to Cloud Run"
  value       = local.final_database_url
  sensitive   = true
}

output "redis_url" {
  description = "Resolved REDIS_URL passed to Cloud Run"
  value       = local.final_redis_url
  sensitive   = true
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name"
  value       = var.use_managed_sql ? google_sql_database_instance.main[0].connection_name : ""
}

output "memorystore_host" {
  description = "Memorystore host"
  value       = var.use_managed_redis ? google_redis_instance.main[0].host : ""
}
