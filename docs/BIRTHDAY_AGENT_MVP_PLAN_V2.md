# Birthday Agent — MVP Plan v2

Date: March 2, 2026
Status: working implementation plan without overengineering

## 1) Principles

- Do not rewrite the current platform: use the existing stack `Next.js + NestJS + Postgres + Redis + BullMQ`.
- Focus on one reliable MVP scenario: `birthday data -> message generation -> email sending`.
- Default delivery mode: `manual approve`.
- Full automation features are enabled only after measurable stability.

## 2) MVP Scope (6-8 weeks)

Included:
- Google OAuth (secure flow with refresh token).
- Birthday import from Google Contacts + Google Calendar.
- Personalized birthday message generation.
- Delivery via Gmail API.
- Daily scheduler.
- Basic workspace: contacts list, upcoming birthdays, draft inbox, approve/send.

Excluded:
- WhatsApp/Instagram/Facebook auto-send.
- Chrome extension scraping.
- Advanced relationship intelligence and vector DB.
- Multi-channel orchestration.

## 3) Implementation Phases

## Phase 1. Domain + Auth (1-2 weeks)

Goal:
- Prepare a secure data and access foundation.

Tasks:
- Add Google OAuth (web flow) with offline access.
- Store OAuth tokens encrypted.
- Implement revoke access and delete account.
- Add tables:
  - `users`
  - `oauth_accounts`
  - `contacts`
  - `birthdays`
  - `message_drafts`
  - `message_logs`

Result:
- User can connect Google account and safely store access credentials.

## Phase 2. Data Aggregator v1 (2-3 weeks)

Goal:
- Reliably collect birthdays from official sources.

Tasks:
- Integrate Google People API (contacts + birthdays).
- Integrate Google Calendar API (birthday/recurring events).
- Implement contact dedupe: `email + normalized_name + birthday_date`.
- Add source priority and confidence.

Result:
- Filled and cleaned birthday dataset with a clear source.

## Phase 3. Message Engine v1 (3-4 weeks)

Goal:
- Generate high-quality short greetings.

Tasks:
- Add prompt template (tone, relationship, language, length).
- Generate draft via Gemini API.
- Store final text and generation metadata.
- Let user edit before sending.

Result:
- Greeting drafts are ready to be sent from UI.

## Phase 4. Scheduler + Delivery v1 (4-5 weeks)

Goal:
- Automate daily execution with risk controls.

Tasks:
- Daily job by user timezone.
- For each birthday: create draft or send (based on mode).
- Integrate Gmail `users.messages.send`.
- Add send idempotency and retry policy.
- Add daily send cap and quiet hours.

Result:
- System sends greetings via email in a stable way.

## Phase 5. Safety + Observability (in parallel)

Goal:
- Make MVP safe and operable in production.

Tasks:
- Sentry + structured logs + correlation IDs.
- Health/readiness + queue metrics.
- Rate limits for sensitive endpoints.
- Audit trail: who/when sent or approved delivery.
- Kill switch for auto-send.

Result:
- Fast issue detection and controlled operation.

## 4) Automation Levels

Level 1 (MVP):
- Import + draft generation + manual approve + send.

Level 2 (after stabilization):
- Auto-send only for trusted contacts and only with risk rules.

Level 3 (next stage):
- Multi-channel and smarter scheduling.

## 5) Deferred to Stage 2

- Gmail email parsing as a mandatory source (optional feature flag only).
- Telegram/WhatsApp connectors.
- Chrome extension (LinkedIn/Facebook extraction).
- Embeddings and advanced relationship scoring.

## 6) MVP Readiness Criteria

- Birthday import from Google is stable and predictable.
- Email sending succeeds and is reproducible.
- No critical incidents related to tokens/private data.
- Full end-to-end pipeline works in prod with manual approve mode.

## 7) Technical Baseline (fixed)

- Backend: `NestJS + Prisma + PostgreSQL + Redis + BullMQ`.
- Frontend: `Next.js`.
- AI: `Gemini API` for text generation.
- Delivery: `Gmail API`.
- Infra: current Docker stack for local development.

## 8) Launch Sequence

1. Internal alpha: manual approve only.
2. Private beta: manual approve + limited auto-rule for trusted segment.
3. Public rollout: after reliability and security metrics are met.

## 9) Fixed Decisions for Manual Stage (No Automation)

Current stage:
- No auto-import.
- No scheduler/cron.
- No auto-send.
- Fully manual pipeline: `contact -> generate draft -> approve -> send now/mark sent`.

### 9.1 Data Model (Manual MVP)

Data ownership:
- All entities are tied to `user_id` (not `session_id`).

Tables:
- `users`
  - `id`
  - `email`
  - `timezone` (default: `UTC`)
  - `created_at`
  - `updated_at`
- `contacts`
  - `id`
  - `user_id`
  - `name` (nullable)
  - `email` (nullable)
  - `email_normalized` (nullable)
  - `birthday_date` (`YYYY-MM-DD`, required)
  - `relationship` (enum, default: `other`)
  - `tone` (enum, default: `neutral`)
  - `source` (enum, future-proof)
  - `created_at`
  - `updated_at`
- `message_drafts`
  - `id`
  - `user_id`
  - `contact_id`
  - `subject`
  - `text`
  - `status` (`draft | approved | sent | failed`)
  - `channel` (nullable)
  - `created_at`
  - `updated_at`
- `message_logs`
  - `id`
  - `user_id`
  - `contact_id`
  - `draft_id` (nullable)
  - `action`
  - `status`
  - `channel` (nullable)
  - `external_message_id` (nullable)
  - `error` (nullable)
  - `timestamp`

Indexes and constraints:
- `UNIQUE (user_id, email_normalized)` only for non-null email.
- Multiple draft records per contact/date are allowed.

Enums:
- `relationship`: `family`, `friend`, `colleague`, `client`, `partner`, `acquaintance`, `other`.
- `tone`: `formal`, `semi_formal`, `friendly`, `warm`, `playful`, `neutral`.
- `source`: `manual_test`, `manual`, `google_contacts`, `google_calendar`, `gmail_parse`, `linkedin_extension`, `facebook_extension`, `import_csv`.

### 9.2 API (Manual MVP)

Contacts:
- `POST /v1/manual/contacts`
- `GET /v1/manual/contacts`
- `PATCH /v1/manual/contacts/:id`
- `DELETE /v1/manual/contacts/:id`

Birthdays:
- `GET /v1/manual/birthdays/today?date=YYYY-MM-DD`
  - If `date` is missing, use current date in `UTC`.

Messages:
- `POST /v1/manual/messages/generate`
  - Required input: `contact_id`
  - Optional overrides: `tone`, `maxWords`, `language`
  - Auto-generates `subject + text`
  - `subject` max length: `120`
  - `text` max length: `1000`
  - Always creates a new draft (no overwrite)
- `GET /v1/manual/messages`
  - Filters: `status`, `channel`, `contact_id`, `date_from`, `date_to`
  - Pagination: `limit`, `cursor`, `sort`
- `GET /v1/manual/messages/:id`
  - Returns message detail + latest logs (limit `20`)
- `PATCH /v1/manual/messages/:id`
  - Edit text only in `draft` status
- `PATCH /v1/manual/messages/:id/approve`
  - Accepts final `subject`/`text` and sets status to `approved`
- `POST /v1/manual/messages/:id/send-now`
  - Manual send trigger
  - Requires `channel`
  - Requires `x-idempotency-key`
  - Retry is manual only
  - `approve` is required before `send-now`
  - For `channel=email`, missing `contact.email` returns `422`
  - Success status: `sent`
  - Error status: `failed`
- `POST /v1/manual/messages/:id/retry`
  - Only for `failed` status
  - Requires new `x-idempotency-key`
  - Reuses same draft (no clone)
- `POST /v1/manual/messages/:id/mark-sent`
  - Manual external send registration
  - Allowed only for `approved`
- `DELETE /v1/manual/messages/:id`
  - Allowed for `draft` and `approved`
  - For `sent` and `failed` return `409 Conflict` (terminal)

Log actions (`message_logs.action`):
- `generated`
- `edited`
- `approved`
- `send_requested`
- `send_succeeded`
- `send_failed`
- `retry_requested`
- `marked_sent`
- `deleted`

### 9.3 Delivery Channels (Manual Stage)

- Manual MVP channels: email + messengers + social channels through `channel` in `send-now`.
- Baseline `channel` enum:
  - `email`
  - `telegram`
  - `whatsapp`
  - `instagram`
  - `facebook`
  - `manual`
- For messengers/socials, use only officially supported APIs and credentials.
- For platforms without full automation, use manual or semi-manual mode and log send fact.

## 10) Final API/UX Decisions (Manual Stage)

- Manual auth: one fixed `dev-user` for all environments.
- Default `users.timezone`: `UTC`.
- Timezone change in settings: not included in manual stage.
- `PATCH /v1/manual/messages/:id/approve` stores final text and sets `approved`.
- `send-now` uses `channel` and supports email/messengers/socials based on available official APIs.
- `send-now` requires `x-idempotency-key`; retries are manual.
- Idempotency uniqueness scope: `UNIQUE(user_id, idempotency_key)`.
- `idempotency_key` is bound to first (`draft_id`, `channel`) pair; payload mismatch returns `409 Conflict`.
- `mark-sent`: `channel` required, `external_message_id` and `notes` optional.
- `sent` and `failed` are terminal statuses.
- Default message language: `en`.
- Default `maxWords`: `100`.
- Max draft text length: `1000` chars.
- Max `subject` length: `120` chars.
- Enable cursor pagination immediately for lists:
  - `default limit = 20`
  - `max limit = 100`
  - `sort = created_at|updated_at`, direction `desc`
- Enable immediate filters for `GET /v1/manual/contacts`:
  - `q`, `relationship`, `has_birthday_today`
- Enable immediate filters for `GET /v1/manual/messages`:
  - `status`, `channel`, `contact_id`, `date_from`, `date_to`
  - Date range is inclusive (`>= date_from`, `<= date_to`)
  - Date format: `YYYY-MM-DD` only (no time)
- Full-text search by `subject/text` is not included in manual stage.

## 11) Data Deletion (Manual Stage)

- `DELETE /v1/manual/contacts/:id`: hard delete.
- Deleting a contact also deletes related `message_drafts` and `message_logs`.

## 12) Additional Rules (Manual Stage)

- Leap day rule (`29-02`) in non-leap years: congratulate on `28-02`.
- If a channel is unavailable (missing token/API/permission), `send-now`:
  - writes `send_failed` to `message_logs`
  - returns HTTP `409 Conflict` with reason.
- If a channel integration is not implemented yet, `send-now` returns `501 Not Implemented`.
- `manual` channel is not used in `send-now`; it is only used for `mark-sent`.
- `name` is optional but recommended for better generation quality.
- Duplicates with same `name + birthday_date` are allowed when email is empty.
- Store generation snapshot fields in `message_drafts`: `language`, `tone`, `maxWords`.
- If contact `name` exists, auto-insert it into generated `subject/text` template.
- Manual-stage sending works as `mock` and is considered successful by default (`100% success`).
- Protect `send-now` from parallel sends of the same draft:
  - transactional status check + idempotency validation
  - parallel request during active send returns `409 Conflict`
- Successful retry allows `failed -> sent` status transition on the same draft.
