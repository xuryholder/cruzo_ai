# Cruzo AI Studio — System Design (MVP v1)

## 1. Document Goal

Define the target architecture of AI Studio (separate from the NFT marketplace) for MVP launch, with scalability and future Web3 integration in mind.

## 2. MVP Scope (what we build now)

- Image generation (image-only).
- Guest sessions without auth (internal/dev environments only).
- Session credits.
- Generation history.
- Async processing via queue.
- Asset storage in object storage.
- Web client (responsive), preparation for mobile and Telegram Mini App.

Out of scope for MVP:

- Video rendering.
- Public release without auth.
- Mint/listing inside AI Studio.

## 3. Product Principles

- AI Studio operates independently from the NFT marketplace.
- Users can generate without Web3.
- Export to NFT marketplace is a separate integration step.
- Frontend never calls the AI provider directly.

## 4. Target Architecture

Flow:

`Client (Web/Mobile/TMA) -> API (NestJS/Fastify) -> Queue (BullMQ/Redis) -> Worker -> AI Provider -> Storage (GCS) -> API status polling`

Key properties:

- Stateless API.
- Heavy operations only via queue.
- Tool-based generation layer.
- AI provider abstraction.
- Private asset storage + signed URLs.

## 5. Technology Baseline (2026)

Frontend:

- Next.js 16 (App Router)
- React 19.2+
- Tailwind CSS 4.1
- shadcn/ui
- TanStack Query v5
- Zustand (minimal)

Backend:

- Node.js 24 LTS
- NestJS 11 + Fastify 5
- Prisma 7 + PostgreSQL (Cloud SQL)
- BullMQ 5 + Redis (Memorystore)
- Google Cloud Storage (GCS)
- Sentry (required for MVP)

Deploy v1:

- Cloud Run (web + api)
- Cloud SQL (Postgres)
- Memorystore (Redis)
- Secret Manager
- Cloud Storage (assets)

## 6. Repository and Modules

```text
cruzo-ai/
  apps/
    web/
    api/
    mobile/   (next phase)
    tma/      (next phase)
  packages/
    api-sdk/
    types/
    ui/
    config/
```

Backend modules (apps/api/src/modules):

- `sessions`
- `credits`
- `generation`
- `queue`
- `storage`
- `rate-limit`
- `health`

## 7. MVP Backend Contracts

Primary endpoints:

- `POST /v1/sessions/bootstrap`
- `GET /v1/credits/balance`
- `POST /v1/generations`
- `GET /v1/generations/:generationId`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/metrics/queue`

UI status model:

- `queued`
- `processing_image`
- `completed`
- `failed`

Polling:

- Every 2–3 seconds until terminal status.

## 8. Queue and Reliability

Job policy:

- `attempts=3`
- backoff: `10s`, `30s`, `90s`
- timeout: `120s`
- `concurrency=1` per worker for MVP

Credits:

- Reserve credit on enqueue.
- Refund on final fail.
- Idempotency via `x-idempotency-key`.

## 9. Credits and Limits

- Dev model: `20` credits per new session.
- `1 generation = 1 credit`.
- Limits:
  - `1` active generation per session.
  - max `3` queued jobs per session.
- Rate limits:
  - `5` requests/min per session.
  - `30` requests/hour per IP.
- UX 429:
  - `Rate limit exceeded. Try again in a minute.`
  - disable buttons + countdown on frontend.

## 10. AI Layer and Moderation

Provider policy:

- Active v1: `Gemini`.

Supported formats:

- `1:1` -> `1024x1024`
- `4:5` -> `1024x1280`
- `9:16` -> `1024x1792`

Moderation (MVP block):

- sexual explicit
- minors
- hate
- self-harm
- extreme violence
- illegal instructions

Error text:

- `Prompt violates safety rules, please rephrase.`

## 11. Storage and Data

Storage policy:

- GCS bucket private.
- Path: `/images/{sessionId}/{generationId}.png`.
- DB stores internal URI (`gs://...`).
- Client receives only signed URL (TTL 24h).

Retention:

- Assets: indefinite.
- Prompt: 90 days full text, then anonymized.

## 12. Auth Strategy

Current state:

- Auth temporarily disabled for development.

Release gate:

- Before external/public staging and production, auth is required.
- Candidates: Clerk or Better Auth (decision separate).

## 13. Clients: Web, Mobile, Telegram Mini App

### Web (MVP first)

- Primary launch client.
- v1 screens: `dashboard`, `generate`, `history`.
- EN-only + i18n structure.

### Mobile (iOS/Android)

- Next phase: Expo React Native.
- Use shared `packages/api-sdk` and `packages/types`.

### Telegram Mini App

- Separate client (or separate route/app) on the same API.
- For production: mandatory server-side verification of Telegram `initData`.

## 14. Integration with NFT Marketplace (future)

- No shared DB and no shared queue.
- Integration only via API/events.
- Flow: user generates in AI Studio -> clicks Export -> moves to marketplace flow.

## 15. Non-functional Requirements

- Generation SLA: usually up to 30s, peak up to 60s.
- Observability:
  - structured logs
  - correlation ids (`sessionId`, `generationId`, `jobId`)
  - Sentry
  - health/readiness checks
- Security:
  - rate limiting
  - moderation
  - private bucket + signed URL
  - ToS/Policy acceptance (in external environments)

## 16. Environments

- `local` (dev, no auth allowed)
- `staging` (required)
- `production`

Release gates:

- auth enabled
- DB backup configured
- Sentry enabled
- smoke tests and health checks pass

## 17. Risks and Mitigations

- Guest-mode abuse risk: mitigated by rate limit + moderation + auth gate.
- Vendor lock-in risk: mitigated by provider abstraction.
- Queue degradation risk: health metrics + retries + refund policy.
- Asset leak risk: private bucket + short-lived signed URLs.

## 18. Implementation Plan (phases)

1. Close backend MVP (done): generation + queue + credits + limits + moderation + health.
2. Build `apps/web` (3 screens + polling + 429 UX).
3. Enable staging, Sentry, release checklist.
4. Add auth before external beta/public.
5. Connect mobile and TMA as separate clients to the shared API.

## 19. Definition of Done (MVP)

- User gets a session and credit balance.
- Can create image generation.
- Sees status and result in history.
- Credits are correctly debited/refunded on final fail.
- Idempotency and queue limits work.
- Rate limits and moderation work.
- Assets stored in storage and served via signed URL.
- Health/readiness/queue metrics are available.
