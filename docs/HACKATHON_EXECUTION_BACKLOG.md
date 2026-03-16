# Gemini Live Agent Challenge - Execution Backlog

## P0 - Critical (must ship)

### Backend
- [x] Implement real `/v1/live/token` ephemeral token minting (remove stub response).
- [ ] Switch live orchestration from mock to real Gemini (`USE_MOCK_LIVE_AGENT=false`) in staging.
- [x] Keep backend as control plane for `/v1/live/session` + `/v1/live/token`.
- [ ] Add strict error mapping for live failures (`token_error`, `stream_error`, `provider_unavailable`).
- [x] Ensure API + worker deployment contract is stable (migrations + queue processing always up).

### Frontend
- [x] Connect `Start Mic` to real microphone capture and live stream transport.
- [x] Implement interrupt/barge-in behavior (`Stop & Edit` cancels active turn).
- [x] Add visible fallback state: `Live unavailable -> using fallback mode`.
- [x] Show deterministic run states:
  `connecting -> ready -> listening -> user_speaking -> model_thinking -> model_streaming -> image_queued -> image_ready/interrupted/fallback`.
- [x] Add header runtime badges (`Mode`, `Transport`, `Mic`, `Token`, `Turn`, `Visual`).
- [ ] Add retry actions for failed live turn and failed visual generation.

## P1 - Judging impact (high score multipliers)

### Backend
- [ ] Persist live session events (`session_started`, `turn_started`, `turn_interrupted`, `turn_completed`, `image_queued`, `image_completed`, `live_fallback_used`).
- [ ] Add trace IDs across live + generation (`liveSessionId`, `generationId`, `jobId`).
- [ ] Add completion/failure counters for live and generation pipeline.
- [ ] Add hardened timeouts and retry policies for provider calls.

### Frontend
- [x] Move `/live` to session-based client adapter (`gemini-live-client.ts`).
- [x] Add PCM adapter for continuous mic chunks (`audio-stream.ts`).
- [x] Remove `Voice Summary` block and avoid duplicate agent text surfaces.
- [x] Add `spellCheck={false}` for prompt and guided textareas.
- [ ] Add transcript improvements: explicit interruption/completion markers + optional timestamps UI polish.
- [ ] Add retry UX for live connect/token failures.

## P2 - Reliability and operations

### Backend
- [ ] Move all sensitive runtime values to Secret Manager (no plain env for prod path).
- [ ] Add Cloud Monitoring alerts (error rate, high queue lag, worker down).
- [ ] Add cost guardrails (daily budget alert + provider usage guard).
- [ ] Add migration/runbook automation to deployment workflow.

### Frontend
- [ ] Add non-blocking toast notifications for API failures and retries.
- [ ] Improve validation messages for prompt length and empty inputs.
- [ ] Add session recovery UX after refresh/disconnect.

## P3 - Demo polish

### Backend
- [ ] Add a single demo reset endpoint/utility for clean runs before recording.
- [ ] Add sample scripted scenarios in seed data/logs for demo stability.

### Frontend
- [ ] Improve micro-animations (state transitions only, avoid noise).
- [ ] Add explicit demo presets (3 one-click scenarios).
- [ ] Improve card metadata panel readability for judges.

## Execution order (updated)

1. P0 finalize staging with real live mode (`USE_MOCK_LIVE_AGENT=false`).
2. P1 backend event persistence + tracing.
3. P1 retry UX + transcript polish.
4. P2 observability and secrets cleanup.
5. P3 demo polish and recording prep.

## Definition of ready for submission

- [x] Live voice interaction works end-to-end with interruption.
- [x] Guided output updates progressively and visual generation completes.
- [ ] Cloud deployment proof is reproducible from repo instructions.
- [ ] Demo script runs without manual patching.
- [ ] Architecture diagram and README match real implementation.

## Current deployed status (March 9, 2026)

- [x] `cruzo-api` deployed and healthy (`/health/live`).
- [x] `cruzo-web` deployed and points to current API.
- [x] `cruzo-worker` deployed with VPC connector + DB/Redis env; queue processing confirmed (`queued -> processing_image -> completed`).
- [ ] Live mode flag in staging/production still needs explicit final verification (`USE_MOCK_LIVE_AGENT`).
