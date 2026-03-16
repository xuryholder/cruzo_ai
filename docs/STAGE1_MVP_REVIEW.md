# Cruzo AI Stage 1 (MVP) — Senior Review

## TL;DR
The spec is strong and architecturally mature for an MVP.  
Main strength: correct separation `web -> api -> queue -> workers -> storage`, with no direct AI calls from the frontend.
After clarification: AI must be a **separate service**, and the NFT audience connects as an optional entitlement integration.
Product model: users can use generation **without any Web3 interaction**, and mint/listing only happens in the NFT marketplace if the user chooses.

Key changes needed to be "production-ready":
- Reduce Stage 1 scope: **MVP = image first**, make video Stage 1.1 (or behind a feature flag).
- Add **idempotency** and protection against double credit charges.
- Clarify **observability** (logs, correlation id, retry policy, DLQ).
- Freeze guest-mode without auth for MVP and define a migration plan to auth in the next phase.
- Add minimum **security** measures: rate limiting, moderation, signed URLs.

## Confirmed MVP Decisions (current)
- Launch audience: general users (not NFT-first).
- MVP content: image generation only.
- Active image provider v1: `Gemini`.
- Supported formats:
  - `1:1` = `1024x1024`
  - `4:5` = `1024x1280`
  - `9:16` = `1024x1792`
- Starter styles:
  - `photorealistic`
  - `3d render`
  - `anime/manga`
  - `watercolor`
  - `minimal flat illustration`
- Prompt templates in UI:
  - Birthday
  - Romance/anniversary
  - Achievement congratulations
  - Thank you
  - Apology
  - Holiday card
- MVP moderation: basic prompt moderation blocking:
  - sexual explicit
  - minors
  - hate
  - self-harm
  - extreme violence
  - illegal instructions
- Moderation error text: `Prompt violates safety rules, please rephrase.`
- Product SLA: usually up to 30s, peak up to 60s.
- Generation limits:
  - 1 active generation per session
  - max 3 queued jobs per session
- Rate limits:
  - 5 requests/min per session
  - 30 requests/hour per IP
- UX on `429`: message `Rate limit exceeded. Try again in a minute.` + disable generate button + countdown to retry.
- Main screens v1: `dashboard`, `generate`, `history`.
- Frontend generation status: polling every 2-3 seconds.
- History v1: `download` + `regenerate`; `delete` deferred to next sprint.
- `regenerate` always costs 1 credit.
- Temporary credit model at launch: `20` free credits once per session, no auto reset.
- Credit reset only manually via dev endpoint.
- Asset retention: indefinite.
- GCS bucket private, only signed URL access (`TTL 24h`), re-sign via API.
- Default image format: `PNG`.
- Prompt retention: store full prompt `90 days`, then anonymize (technical tags kept).
- NFT export: not a priority for MVP.
- Watermark: not used in MVP.
- UI language v1: `EN-only`, with i18n structure for future RU.
- Auth temporarily disabled for development (guest-mode); before public launch enable `Clerk` or `Better Auth`.
- ToS/Policy: mandatory acceptance before first generation in external environments; can be disabled locally in dev.
- Monitoring: `Sentry` required from day 1 of MVP.
- Deploy v1:
  - `Cloud Run` (web + api)
  - `Cloud SQL` (Postgres)
  - `Memorystore` (Redis)
  - `Secret Manager`
  - `Cloud Storage` (assets)
- Delivery process:
  - separate `staging` is required before `production`
  - DB backups are a release gate
- DB layer: `Prisma`.

## Updated Stack (February 2026)
Below is the recommended baseline configuration for a modern, supported production stack.

### Frontend
- `Next.js 16.x` (not 15) + App Router.
- `React 19.2.x` with required security patch (use `>=19.2.1`).
- Note: Next.js 16 App Router uses latest React Canary under the hood; pin the minor version and regularly update patch releases.
- `Tailwind CSS 4.x` (including v4.1+ improvements).
- `shadcn/ui` (compatible with React 19 + Tailwind v4).
- `TanStack Query v5`.
- `Zustand v5` only for local UI state.

### Backend
- `Node.js 24 LTS` as base runtime for web/api/worker.
- `NestJS 11.x`.
- `Fastify 5.x` adapter.
- `Prisma 7.x`.
- `BullMQ 5.x`.
- `Memorystore (Redis)`.
- `PostgreSQL` (Cloud SQL).

### AI Layer
- For text/tool flows: `Gemini API`.
- For image generation: `Gemini Image` models.

### Auth (after dev-only guest mode)
- For public beta/prod: choose `Clerk` or `Better Auth`.
- `Auth.js` is acceptable only if strict legacy compatibility is required; for new integrations prefer `Better Auth`/`Clerk`.

### Media / Video
- `Remotion 4.x` remains relevant and actively updated.
- Note: Remotion has commercial licensing for companies (budget for Stage 1.1+).

### Storage & Security
- `Google Cloud Storage (GCS)` private bucket + signed URLs (TTL 24h) matches best practice.
- Patch policy: enable automatic dependency updates (at least patch) and security advisories for Next.js/React.

---

## What is correct
- Monorepo with separation `apps` and `packages` is scalable.
- Frontend does not call the AI provider directly.
- Tool-based modularity in backend even before agent integration is the right foundation.
- Async generation via BullMQ is correct for heavy workloads.
- External object storage (GCS), not files in DB.
- AI abstraction layer (`ImageProvider`) is critical for provider switching and fallback.
- Separating API/worker load and stateless API is good for horizontal scaling.
- Separating AI service from NFT marketplace reduces coupling and regression risk in legacy.

---

## What is debatable or needs changes

### 1) MVP scope is overloaded
Current MVP includes image + video + payments + credits + auth + infra.
Risk: schedule slips and unstable release.

Recommendation:
- Stage 1 (MVP): `guest dashboard + image generation + credits + history + GCS`.
- Stage 1.1: `video rendering via Remotion`.

### 2) Credits model is too minimal for real billing
Current `credits(balance)` table is insufficient for audit and idempotency.

Add:
- `credit_ledger` (immutable events: grant/debit/refund).
- Unique `idempotency_key` per debit.
- Transactional logic: write generation + debit atomically (where possible).

### 3) Generation status is too thin for operations
`pending|completed|failed` is not enough for debugging and UX.

Add statuses:
- `queued`, `processing_image`, `processing_video`, `completed`, `failed`, `canceled`.

### 4) Queue policy must be formalized in config
Baseline values already agreed:
- `attempts = 3`
- `backoff = exponential (10s, 30s, 90s)`
- `timeout = 120s`
- credit reserve on enqueue, refund on final fail

Recommendation:
- Explicitly set `removeOnComplete` and `removeOnFail`.
- Use a dead-letter queue for persistent errors.

### 5) Temporary no-auth dev mode requires anti-abuse
Guest-mode speeds launch but increases abuse risk.

Recommendation:
- Issue `anonymous_session_id` (httpOnly cookie) as actor id.
- Add rate limit by IP + session (`5/min session`, `30/hour IP`).
- Add CAPTCHA after suspicious activity.
- Plan migration to full auth as a release gate before public launch.

### 6) OpenAPI + Zod needs a deliberate implementation
NestJS default is class-validator.  
If Zod is required, lock the stack (e.g., `nestjs-zod`) in ADR; otherwise docs/validation will drift.

### 7) Security gap
Minimum required:
- rate limit on `/generation` (`5/min session`, `30/hour IP`).
- moderation guard for prompt (sexual explicit, minors, hate, self-harm, extreme violence, illegal instructions).
- signed URLs for private assets (GCS private, TTL 24h, re-sign endpoint).
- ToS/Policy acceptance before first generation in external environments.
- Stripe webhooks with signature verification (when payments are enabled).
- for no-auth: anti-abuse layer (IP throttling + session throttling + CAPTCHA escalation).

### 8) Missing observability
Without this, queue/render ops are hard to maintain.

Add:
- structured logging (requestId/generationId/sessionId/jobId).
- health endpoints (`/health/live`, `/health/ready`).
- basic queue latency/failure rate metrics.
- Sentry from day one of MVP.

### 9) NFT integration must be across service boundaries only
Do not mix AI and NFT in the same DB/queues.

Recommendation:
- AI service has its own DB/queue/storage (auth disabled in MVP).
- NFT backend passes entitlement only (e.g., `nft_pass=true`) via signed JWT or server-to-server API.
- No direct joins between AI and NFT tables.

### 10) Wallet connect must not be required in AI Studio
If user does not want to mint, Web3 should not be in the MVP critical path.

Recommendation:
- Primary UX: guest-mode and standard generation.
- CTA `Export to NFT` routes user to marketplace flow.
- Wallet connection happens within marketplace, not blocking AI-only flow.

---

## Recommended Minimum DB Schema (Stage 1)

### `sessions`
- `id (uuid, pk)`  // anonymous_session_id
- `fingerprint_hash (nullable)`
- `created_at`
- `last_seen_at`

### `credits`
- `session_id (pk/fk)`
- `balance (int, >=0)`
- `updated_at`

### `credit_ledger`
- `id`
- `session_id`
- `generation_id (nullable)`
- `type (grant|debit|refund)`
- `amount (int)`
- `idempotency_key (unique)`
- `created_at`

### `generations`
- `id`
- `session_id`
- `prompt`
- `style`
- `status`
- `error_code (nullable)`
- `image_url (nullable)`
- `video_url (nullable)`
- `created_at`
- `updated_at`

### `user_preferences`
- `session_id (pk/fk)`
- `default_tone`
- `default_style`

---

## Recommended Pipeline (revision)
1. API accepts request + checks `anonymous_session_id` + rate limit (`5/min session`, `30/hour IP`) + concurrency (1 active, max 3 queued).
2. Checks credits and reserves/debits 1 credit (idempotent).
3. Creates `generation` with status `queued`.
4. Enqueues job in `generate-image` queue.
5. Worker generates image via `ImageProvider`.
6. Stores image in GCS, updates status.
7. If video enabled: enqueue `render-video`, then store mp4 and complete.
8. Any error: status `failed`, ledger `refund` if needed.

Optional for NFT:
9. Before debiting credits, verify entitlement from NFT service (e.g., free quota/premium style access).

Mint flow (outside MVP critical path):
10. User clicks `Export to NFT`.
11. AI service provides `assetUrl + metadata` to marketplace via signed API contract.
12. Mint/listing happens only in NFT service.

---

## Revised Definition of Done (realistic)

### Stage 1 (MVP)
- In dev mode, user enters without registration (guest-mode).
- In dev mode, public `/dashboard` is available under `anonymous_session_id`.
- Image generation works via queue.
- Result is stored in GCS.
- Asset access via signed URL (24h).
- Default format: PNG.
- Credit debited exactly once (idempotent).
- Generation history is saved.
- History supports `download` and `regenerate` (regenerate = 1 credit).
- Generation status updates via polling (2-3s).
- On `429`, frontend shows error text, disables button, shows countdown to retry.
- Prompt retention: 90 days full text, then anonymized.
- Basic retries + logging + healthchecks.
- Sentry connected.
- AI service runs independently from NFT marketplace.
- User can complete AI flow without wallet connect.
- UI v1 in English (EN-only), with i18n structure ready.
- ToS/Policy accepted before first generation in external environments.
- Staging environment exists before production.
- DB backups are a release gate.
- Auth enabled (`Clerk` or `Better Auth`) before public launch.

### Stage 1.1
- mp4 generation via separate queue.
- Video stored in GCS.
- Correct statuses and error/refund handling.
- NFT entitlement integrated as an option (no shared DB).
- `Export to NFT` contract added for seamless asset transfer to marketplace.

---

## Senior verdict
The spec is **directionally correct and architecturally solid**.  
The main issue is not architecture, but **scope density for MVP** and missing operational details (idempotency, retries, observability, security minimum).

With the fixes above, this becomes truly `MVP-ready` and also `agent-ready`.

---

## Stack and Architecture Critique (senior)

### What looks excessive for Stage 1
1. Building the full video pipeline + NFT export contracts in an image-only MVP.
2. Early detailing of entitlement integrations when NFT is not a release priority.
3. Heavy observability baseline (metrics/health/Sentry/tracing) without a staged rollout plan.

### What is missing (critical gaps)
1. No FinOps guardrails:
   - provider cost limits per day/month;
   - hard-stop on budget overrun;
   - cost anomaly alerts.
2. No full anti-abuse plan for guest-mode:
   - protection against repeated session resets;
   - device fingerprint strategy;
   - progressive friction (captcha/challenge escalation).
3. Privacy/compliance processes not described:
   - user data deletion on request;
   - data export;
   - logging policy with PII.
4. Disaster recovery not defined:
   - RPO/RTO;
   - regular backup restore verification.
5. Rollout/rollback process not described:
   - canary/blue-green or at least staged rollout;
   - rollback playbook for generation degradation.
6. Minimum test strategy not defined:
   - API contract tests;
   - e2e happy/unsafe/rate-limit paths;
   - queue and worker retry/refund smoke tests.
7. Vendor fallback runbook missing:
   - what to do on Gemini degradation;
   - how quickly to activate the backup provider.

### What is potentially risky in current decisions
1. Indefinite asset retention without lifecycle tiers can drive storage cost.
2. Polling every 2-3 seconds can overload API as DAU grows; SSE/WebSocket needed later.
3. `20` credits per session in guest-mode is easily abused without stronger anti-fraud logic.
4. `PNG` as default can be expensive for storage/egress; add adaptive export (`PNG/JPEG`).

### Recommended optimization priority
1. Release blockers:
   - budget limits + alerts;
   - anti-abuse hardening;
   - backup restore drill;
   - auth release gate before external beta.
2. Sprint+1:
   - storage lifecycle policy (hot/cold/retention classes);
   - move from polling to SSE as load grows;
   - provider fallback runbook + feature flag.
3. Sprint+2:
   - privacy automation (delete/export flows);
   - expanded SLO/SLI and queue alerting.

---

## Sources
- Next.js 16: https://nextjs.org/blog/next-16
- React 19.2 and security patch: https://react.dev/blog/2025/10/01/react-19-2
- Tailwind v4.1: https://tailwindcss.com/blog/tailwindcss-v4-1
- TanStack Query v5 docs: https://tanstack.com/query/latest/docs/framework/react/overview
- shadcn + Tailwind v4: https://ui.shadcn.com/docs/tailwind-v4
- Prisma ORM 7: https://www.prisma.io/blog/announcing-prisma-orm-7-0-0
- Fastify v5 migration: https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
- Nest v11 migration: https://docs.nestjs.com/migration-guide
- Node 24 LTS (current releases): https://nodejs.org/en/about/previous-releases
- Auth.js / Better Auth position: https://github.com/nextauthjs/next-auth , https://www.better-auth.com/blog/authjs-joins-better-auth
- Remotion licensing: https://www.remotion.dev/pricing
- Bull (maintenance mode): https://www.npmjs.com/package/bull
- BullMQ docs: https://docs.bullmq.io/
