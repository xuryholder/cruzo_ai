# Cruzo AI - Gemini Live Agent Challenge

Cruzo is a multimodal greeting-card agent focused on real-time interaction:
- live voice input (Gemini Live session path)
- interruptible responses (`Stop & Edit`)
- guided text + visual card generation
- automatic fallback when live transport is unavailable

## Repository Structure

- `apps/web` - Next.js frontend (`/live`, `/studio`)
- `apps/api` - NestJS backend (`/v1/live/*`, generation APIs)
- `infra/terraform` - Google Cloud infrastructure (Cloud Run, SQL, Redis, Secret Manager)

## Local Spin-up (Judges)

Prerequisites:
- Docker + Docker Compose
- API keys in environment if running non-mock providers

Run:

```bash
docker compose up --build
```

Open:
- Web: `http://localhost:3000`
- API: `http://localhost:4000`

## Reproducible Testing (Judges)

The fastest way to reproduce the full demo is the Docker flow below. It includes a live/real-time path and a fallback path, plus image generation.

1. Start the stack:

```bash
docker compose up --build
```

2. Open the web app: `http://localhost:3000`
3. Test the Live Agent path:
   - Go to `/live`
   - Click `Start Mic`
   - Speak a greeting request
   - Click `Stop & Edit` while the model is streaming
   - Start a new turn and let it complete
   - Confirm image generation starts after `response_complete`
4. Test the fallback path:
   - Disable mic permissions or live transport
   - The app will fall back to `MediaRecorder` -> `/api/live/transcribe` -> `/api/live/turn`
5. Test manual generation:
   - Go to `/studio`
   - Generate text and image
   - Save draft and confirm status transitions

## Cloud Deployment Proof

Project: `greeting-ai-agent`  
Region: `us-central1`  
API service: `cruzo-api`  
Observed on: March 9, 2026

Verification commands:

```bash
gcloud run services describe cruzo-api \
  --region us-central1 \
  --project greeting-ai-agent \
  --format=json | rg "USE_MOCK_LIVE_AGENT|\"value\": \"false\""

curl -sS https://cruzo-api-2nbtnvqmma-uc.a.run.app/health/live
```

Current health response includes:
- `"liveAgentMode":"live"`
- `"imageProviderMode":"live"`
- `"storageMode":"live"`

## Public Demo URL

- Live agent: `https://cruzo-web-737583534313.us-central1.run.app/live`

## Architecture Diagram

Source diagram (Mermaid) is stored at `docs/architecture-diagram.mmd`. Exported image should be uploaded to the hackathon submission "Image Gallery" or "File Upload" section.

## Documentation

Project docs are organized under `docs/`. Start with `docs/INDEX.md`.

## Security

- Never commit secrets. Use `.env` locally and Google Secret Manager in production.
- Rotate keys immediately if exposure is suspected.
- Least-privilege service accounts for Cloud Run, Cloud SQL, and Cloud Storage.

## Repro Scenario (Live Agents category)

1. Open `/live`.
2. Click `Start Mic`.
3. Speak a greeting request.
4. Click `Stop & Edit` while model is streaming to test interruption.
5. Start a new turn and let it complete.
6. Confirm image generation starts after `response_complete`.
7. Confirm badges show mode/transport/turn/visual states.

## Architecture Notes

Current path:
- frontend requests `/api/live/session` + `/api/live/token`
- browser opens Gemini Live session directly (session-based client adapter)
- PCM chunks stream from mic (`16k mono PCM`)
- on `response_complete`, frontend triggers `/api/studio/generations`
- polling path handles image completion

Fallback path:
- `MediaRecorder` + `/api/live/transcribe` + `/api/live/turn`

## Automated Deployment (IaC)

Infrastructure-as-code is implemented in `infra/terraform` (Cloud Run, SQL, Redis, Secret Manager). This is the automated deployment section to reference for bonus points.
