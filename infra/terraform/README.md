# Terraform - Cruzo Live Agent (GCP)

## Scope
This stack bootstraps the minimum infra for hackathon deployment:
- Required GCP APIs
- Artifact Registry (Docker)
- Cloud Run API service
- Secret Manager secret for `GOOGLE_API_KEY`
- Managed Cloud SQL Postgres (optional, enabled by default)
- Managed Memorystore Redis + VPC connector (optional, enabled by default)

## Prerequisites
- Authenticated gcloud and Terraform installed
- Existing GCP project: `greeting-ai-agent`

## Usage
```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

## Mock -> Live switch
1. Deploy with default `USE_MOCK_LIVE_AGENT=true` (safe stabilization mode)
2. Validate `/live` end-to-end on Cloud Run
3. Update Cloud Run env `USE_MOCK_LIVE_AGENT=false`
4. Redeploy and verify real Gemini path

### Verified live-mode command sequence

```bash
# Confirm deployed env flag
gcloud run services describe cruzo-api \
  --region us-central1 \
  --project greeting-ai-agent \
  --format=json | rg "USE_MOCK_LIVE_AGENT|\"value\": \"false\""

# Health proof (must show liveAgentMode=live)
curl -sS https://cruzo-api-2nbtnvqmma-uc.a.run.app/health/live
```

Expected health signal:

```json
{
  "status": "ok",
  "liveAgentMode": "live"
}
```

## Notes
- For hackathon speed, Cloud SQL is provisioned with public IPv4 and broad authorized network.
- Restrict DB networking and move all sensitive runtime vars to Secret Manager before production.
- Cloud Run is public by default (`allow_unauthenticated=true`) for demo convenience.
