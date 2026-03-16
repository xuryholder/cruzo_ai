# Final Spec: Live + Guided Canvas

## 1) Goal
Deliver a stable multimodal UX (2026-2028 quality) where:
- user can speak and type in one interface,
- live response is streaming and interruptible,
- image generation starts after turn completion,
- fallback works automatically without breaking primary flow.

## 2) UX Contract
- One composer for text + voice.
- Primary actions only:
  - `Mic` (toggle Start/Stop)
  - `Send`
- Remove `Stop & Edit` as separate button.
- User must not be forced to press `Stop` to get a response.
- User turn auto-closes after pause.
- After `response_complete`, mic returns to `listening` when mic mode is active.
- Interrupt is available during `model_streaming` via the same mic control/state.

## 3) State Machine
States:
- `connecting`
- `ready`
- `listening`
- `user_speaking`
- `model_thinking`
- `model_streaming`
- `image_queued`
- `image_ready`
- `interrupted`
- `fallback`

Mandatory happy-path transition:
`listening -> user_speaking -> model_thinking -> model_streaming -> image_queued -> image_ready -> listening`

## 4) Transport and Backend Contract
Primary path:
- `POST /v1/live/session`
- `POST /v1/live/token`
- browser Gemini Live session over WS

Secondary fallback path:
- `POST /v1/live/transcribe`
- `POST /v1/live/turn`

Rules:
- Production token must use a bidi-compatible working live model.
- Transport errors must be compact in UI (badge/toast + fallback marker), no noisy red spam.

## 5) Audio and Turn Boundary
- PCM 16k mono chunks.
- Auto end of user turn by:
  - silence-based VAD boundary,
  - hard timeout fail-safe if VAD misses.
- No-speech timeout:
  - if user stays silent for N seconds, close attempt with a soft message.

## 6) Chat Log and Agent Actions
- One timeline; no duplicated system messages.
- Event/message types:
  - `user`
  - `agent_streaming`
  - `agent_final`
  - `interrupted`
  - `image_status`
- Streaming bubble is single; transforms into final on completion.
- Never duplicate `Turn interrupted` in multiple surfaces.
- Technical logs (`ws/token`) go to debug drawer, not primary timeline.

## 7) Visual Process and Motion
- Listening pulse on mic.
- User speaking waveform.
- Thinking chip (`Thinking...`).
- Streaming cursor in agent response.
- Image progress steps: `Queued -> Rendering -> Ready`.
- Interrupt chip auto-hide after 2-3s.
- Motion timing 150-250ms, minimal and purposeful.

## 8) UI Cleanup
- Do not hide text input during voice mode.
- Do not hide `Send`; text and voice are parallel modalities.
- Remove central noisy red errors.
- Keep runtime badges compact.

## 9) Reliability and Telemetry
Persist events:
- `session_started`
- `turn_started`
- `turn_interrupted`
- `turn_completed`
- `image_queued`
- `image_completed`
- `live_fallback_used`

Correlate IDs:
- `liveSessionId`
- `turnId`
- `generationId`

Require explicit fallback reason codes.

## 10) Mandatory Test Pack
- Contract smoke (API endpoints + SSE ordering).
- Live SDK probe (connect/send/receive/close reason).
- Mode tests (`live`, `fallback`).
- Front state-machine tests.
- One browser e2e:
  - `Start Mic -> speech -> auto turn end -> streaming response -> image queued -> image ready`.

## 11) Definition of Done
- In live mode user sees streaming response without manual `Stop`.
- Interrupt behavior is predictable.
- Chat log is clean (no duplicates/noise).
- Image pipeline starts after completed live turn.
- Fallback is automatic and clearly marked.
- Production and local show same behavior for key scenario.

---

## Delivery Phases

### P0 - Core Live UX (blocker)
Scope:
- Single composer behavior (text + voice in one flow).
- Remove `Stop & Edit`.
- Auto turn boundary (silence + hard timeout + no-speech timeout).
- Stable streaming output in timeline and draft.
- Auto-return to `listening` after `response_complete` when mic is active.

Done when:
- User can speak naturally without manual stop and get live streaming response.

### P1 - Chat Log and Visual Clarity
Scope:
- Unify timeline event model (`user`, `agent_streaming`, `agent_final`, `interrupted`, `image_status`).
- Remove duplicate interruption/error surfaces.
- Add motion states (pulse/waveform/thinking/streaming cursor/image progress).
- Compact badges and debug drawer split.

Done when:
- Timeline is readable, non-duplicated, and process is visually obvious.

### P2 - Reliability, Observability, and Proof
Scope:
- Event persistence and correlation (`liveSessionId`, `turnId`, `generationId`).
- Fallback reason codes.
- Full required test pack automated in CI/dev scripts.
- Production parity checks with reproducible smoke script.

Done when:
- Failures are diagnosable within minutes and demo flow is repeatable.

## Out of Scope (for this iteration)
- Full custom WebRTC stack.
- New backend stream proxy (unless WS path remains unstable after P0).
- Rebuild of image worker architecture.
