variable "project_id" {
  type        = string
  description = "GCP project ID"
  default     = "greeting-ai-agent"
}

variable "region" {
  type        = string
  description = "Primary region for Cloud Run and Artifact Registry"
  default     = "us-central1"
}

variable "artifact_repository_id" {
  type        = string
  description = "Artifact Registry repository name"
  default     = "cruzo"
}

variable "run_service_name" {
  type        = string
  description = "Cloud Run service name for API"
  default     = "cruzo-api"
}

variable "container_image" {
  type        = string
  description = "Container image URL to deploy"
  default     = "us-central1-docker.pkg.dev/greeting-ai-agent/cruzo/cruzo-api:latest"
}

variable "google_api_key" {
  type        = string
  description = "Gemini API key stored in Secret Manager"
  default     = ""
  sensitive   = true
}

variable "database_url" {
  type        = string
  description = "Postgres connection string"
  default     = ""
  sensitive   = true
}

variable "redis_url" {
  type        = string
  description = "Redis connection string"
  default     = ""
  sensitive   = true
}

variable "gcs_bucket" {
  type        = string
  description = "Bucket for generated assets"
  default     = ""
}

variable "allow_unauthenticated" {
  type        = bool
  description = "Allow public invoker for demo"
  default     = true
}

variable "use_managed_sql" {
  type        = bool
  description = "Provision Cloud SQL and auto-wire DATABASE_URL"
  default     = true
}

variable "sql_instance_name" {
  type        = string
  description = "Cloud SQL instance name"
  default     = "cruzo-postgres"
}

variable "sql_database_name" {
  type        = string
  description = "Application database name"
  default     = "cruzo_ai"
}

variable "sql_user_name" {
  type        = string
  description = "Application database username"
  default     = "cruzo"
}

variable "sql_tier" {
  type        = string
  description = "Cloud SQL tier"
  default     = "db-custom-1-3840"
}

variable "sql_edition" {
  type        = string
  description = "Cloud SQL edition"
  default     = "ENTERPRISE"
}

variable "use_managed_redis" {
  type        = bool
  description = "Provision Memorystore and auto-wire REDIS_URL"
  default     = true
}

variable "redis_instance_name" {
  type        = string
  description = "Memorystore instance name"
  default     = "cruzo-redis"
}

variable "redis_tier" {
  type        = string
  description = "Memorystore tier"
  default     = "BASIC"
}

variable "redis_memory_size_gb" {
  type        = number
  description = "Memorystore memory size in GB"
  default     = 1
}

variable "vpc_network_name" {
  type        = string
  description = "VPC network name used by Memorystore"
  default     = "default"
}

variable "vpc_connector_name" {
  type        = string
  description = "Serverless VPC connector name for Cloud Run -> Redis access"
  default     = "cruzo-run-connector"
}

variable "vpc_connector_cidr" {
  type        = string
  description = "CIDR block for serverless VPC connector"
  default     = "10.8.0.0/28"
}

variable "vpc_connector_min_instances" {
  type        = number
  description = "Minimum connector instances"
  default     = 2
}

variable "vpc_connector_max_instances" {
  type        = number
  description = "Maximum connector instances"
  default     = 3
}
