locals {
  required_services = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "vpcaccess.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_services)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

data "google_compute_network" "selected" {
  name = var.vpc_network_name

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository" "cruzo" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "Container images for Cruzo"
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "run_runtime" {
  account_id   = "cruzo-run-runtime"
  display_name = "Cruzo Cloud Run Runtime"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "google_api_key" {
  secret_id = "google-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "google_api_key" {
  count = var.google_api_key == "" ? 0 : 1

  secret      = google_secret_manager_secret.google_api_key.id
  secret_data = var.google_api_key
}

resource "google_secret_manager_secret_iam_member" "google_api_key_reader" {
  secret_id = google_secret_manager_secret.google_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run_runtime.email}"
}

resource "random_password" "sql_password" {
  count = var.use_managed_sql ? 1 : 0

  length  = 24
  special = false
}

resource "google_sql_database_instance" "main" {
  count = var.use_managed_sql ? 1 : 0

  name             = var.sql_instance_name
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_16"

  settings {
    edition = var.sql_edition
    tier = var.sql_tier

    backup_configuration {
      enabled = true
    }

    ip_configuration {
      ipv4_enabled = true

      # Hackathon speed setting. Restrict this for production.
      authorized_networks {
        name  = "public-demo"
        value = "0.0.0.0/0"
      }
    }
  }

  deletion_protection = true

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "app" {
  count = var.use_managed_sql ? 1 : 0

  name     = var.sql_database_name
  instance = google_sql_database_instance.main[0].name
  project  = var.project_id
}

resource "google_sql_user" "app" {
  count = var.use_managed_sql ? 1 : 0

  project  = var.project_id
  instance = google_sql_database_instance.main[0].name
  name     = var.sql_user_name
  password = random_password.sql_password[0].result

  lifecycle {
    ignore_changes = [password]
  }
}

resource "google_vpc_access_connector" "run" {
  count = var.use_managed_redis ? 1 : 0

  name          = var.vpc_connector_name
  project       = var.project_id
  region        = var.region
  network       = data.google_compute_network.selected.name
  ip_cidr_range = var.vpc_connector_cidr

  depends_on = [google_project_service.required]
}

resource "google_redis_instance" "main" {
  count = var.use_managed_redis ? 1 : 0

  name               = var.redis_instance_name
  project            = var.project_id
  region             = var.region
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_size_gb
  authorized_network = data.google_compute_network.selected.self_link

  depends_on = [google_project_service.required]
}

locals {
  managed_database_url = var.use_managed_sql ? format(
    "postgresql://%s:%s@%s:5432/%s",
    var.sql_user_name,
    random_password.sql_password[0].result,
    google_sql_database_instance.main[0].public_ip_address,
    var.sql_database_name,
  ) : ""

  managed_redis_url = var.use_managed_redis ? format(
    "redis://%s:%d",
    google_redis_instance.main[0].host,
    google_redis_instance.main[0].port,
  ) : ""

  final_database_url = var.database_url != "" ? var.database_url : local.managed_database_url
  final_redis_url    = var.redis_url != "" ? var.redis_url : local.managed_redis_url
}

resource "google_cloud_run_v2_service" "api" {
  name     = var.run_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account = google_service_account.run_runtime.email

    dynamic "vpc_access" {
      for_each = var.use_managed_redis ? [1] : []
      content {
        connector = google_vpc_access_connector.run[0].id
        egress    = "PRIVATE_RANGES_ONLY"
      }
    }

    containers {
      image = var.container_image
      command = ["sh", "-c"]
      args    = ["npx prisma migrate deploy && node dist/main.js"]

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "GCS_BUCKET"
        value = var.gcs_bucket
      }

      env {
        name  = "USE_MOCK_LIVE_AGENT"
        value = "false"
      }

      env {
        name  = "USE_MOCK_STORAGE_PROVIDER"
        value = "false"
      }

      env {
        name  = "USE_MOCK_IMAGE_PROVIDER"
        value = "false"
      }

      env {
        name  = "GEMINI_TEXT_MODEL"
        value = "gemini-2.5-flash"
      }

      env {
        name  = "DATABASE_URL"
        value = local.final_database_url
      }

      env {
        name  = "REDIS_URL"
        value = local.final_redis_url
      }

      env {
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_api_key.secret_id
            version = "latest"
          }
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
  }

  depends_on = [
    google_project_service.required,
    google_artifact_registry_repository.cruzo,
    google_secret_manager_secret_iam_member.google_api_key_reader,
    google_sql_database.app,
    google_sql_user.app,
    google_redis_instance.main,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = google_cloud_run_v2_service.api.project
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
