# @cruzo/api

Minimal backend vertical slice for AI image generation:

- `POST /v1/sessions/bootstrap` create anonymous session + grant 20 credits
- `GET /v1/credits/balance` read current credits
- `POST /v1/generations` create queued image generation job
- `GET /v1/generations/:generationId` read generation status
- `POST /v1/live/session` create live orchestration session
- `POST /v1/live/turn` generate guided output turn (Gemini/fallback)
- session limits: `1 active` + `max 3 queued` generations
- idempotency: pass `x-idempotency-key` on generation create

Provider selection is config-driven:

- `IMAGE_PROVIDER=openai` (default)
- `IMAGE_PROVIDER=fal` (adapter is implemented but off by default)

## Quick start

1. Install deps

```bash
npm install
```

2. Copy env

```bash
cp .env.example .env
```

3. Apply DB migrations

```bash
npm run prisma:deploy
```

4. Run API

```bash
npm run dev
```

5. Run worker

```bash
npm run dev:worker
```

## Docker (recommended for local infra)

Run API + Worker + Postgres + Redis:

```bash
docker compose up --build
```

Run in background:

```bash
docker compose up -d --build
```

Stop stack:

```bash
docker compose down
```

Reset with database volume cleanup:

```bash
docker compose down -v
```

## Smoke test

```bash
# 1) Bootstrap anonymous session and store cookie
curl -i -c cookie.txt -X POST http://localhost:4000/v1/sessions/bootstrap

# 2) Create generation job
curl -b cookie.txt -X POST http://localhost:4000/v1/generations \\
  -H 'content-type: application/json' \\
  -H 'x-idempotency-key: test-job-1' \\
  -d '{\"prompt\":\"Birthday postcard with balloons\",\"style\":\"watercolor\",\"aspectRatio\":\"1:1\"}'

# 3) Check generation status
curl -b cookie.txt http://localhost:4000/v1/generations/<generationId>
```

## Cloud Run live-mode check

```bash
gcloud run services describe cruzo-api \
  --region us-central1 \
  --project greeting-ai-agent \
  --format=json | rg "USE_MOCK_LIVE_AGENT|\"value\": \"false\""

curl -sS https://cruzo-api-2nbtnvqmma-uc.a.run.app/health/live
```
