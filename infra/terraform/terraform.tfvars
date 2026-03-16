project_id      = "greeting-ai-agent"
region          = "us-central1"
container_image = "us-central1-docker.pkg.dev/greeting-ai-agent/cruzo/cruzo-api:latest"

use_managed_sql   = true
use_managed_redis = true

database_url   = ""
redis_url      = ""
google_api_key = ""
gcs_bucket     = "greeting-ai-agent-assets-737583534313"
