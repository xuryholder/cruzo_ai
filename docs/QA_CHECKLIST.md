# Cruzo AI API — QA Checklist (MVP Vertical Slice)

This checklist validates the implemented backend slice:
- sessions bootstrap
- credits debit/refund
- generation queue + worker
- idempotency
- queue limits
- rate limits (session/IP)
- prompt moderation
- health endpoints + queue metrics
- GCS signed URL flow

## 1) Prerequisites

1. Docker is installed.
2. Port `4000`, `5432`, `6379` are free.
3. Run from repo root: `/home/xuryholder/cruzo_ai`.

## 2) Start Stack

```bash
docker compose up -d --build
docker compose ps
```

Expected:
- `cruzo-api` is `Up`
- `cruzo-worker` is `Up`
- `cruzo-postgres` is `Up (healthy)`
- `cruzo-redis` is `Up (healthy)`

## 3) Smoke Happy Path

### 3.1 Bootstrap session
```bash
curl -sS -c /tmp/cruzo_cookie_qa.txt -X POST http://localhost:4000/v1/sessions/bootstrap \
  -H 'content-type: application/json' -d '{}'
```

Expected:
- JSON with `sessionId`
- `balance` = `20`

### 3.2 Check balance
```bash
curl -sS -b /tmp/cruzo_cookie_qa.txt http://localhost:4000/v1/credits/balance
```

Expected:
- `{"balance":20}`

### 3.3 Create generation
```bash
curl -sS -b /tmp/cruzo_cookie_qa.txt -X POST http://localhost:4000/v1/generations \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: qa-happy-1' \
  -d '{"prompt":"QA happy path card","style":"watercolor","aspectRatio":"1:1"}'
```

Expected:
- `status` = `queued`
- `remainingCredits` = `19`
- `deduplicated` = `false`

### 3.4 Poll status
```bash
# replace <GEN_ID>
curl -sS -b /tmp/cruzo_cookie_qa.txt http://localhost:4000/v1/generations/<GEN_ID>
```

Expected:
- transitions to `status=completed`
- `imageUrl` is not null

### 3.5 Balance after completion
```bash
curl -sS -b /tmp/cruzo_cookie_qa.txt http://localhost:4000/v1/credits/balance
```

Expected:
- `{"balance":19}`

## 4) Idempotency Test

Run same request twice with same `x-idempotency-key`:

```bash
curl -sS -b /tmp/cruzo_cookie_qa.txt -X POST http://localhost:4000/v1/generations \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: qa-idem-1' \
  -d '{"prompt":"Idem test","style":"watercolor","aspectRatio":"1:1"}'

curl -sS -b /tmp/cruzo_cookie_qa.txt -X POST http://localhost:4000/v1/generations \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: qa-idem-1' \
  -d '{"prompt":"Idem test","style":"watercolor","aspectRatio":"1:1"}'
```

Expected:
- same `generationId`
- second response has `deduplicated=true`
- credits not decremented second time

## 5) Queue Limit Test (max 3 queued)

Temporarily stop worker to accumulate queued jobs:

```bash
docker compose stop worker
```

Create 4 jobs in same session (`x-idempotency-key` different each time).

Expected:
- 1st, 2nd, 3rd => HTTP `202`
- 4th => HTTP `429` with message:
  - `Maximum queued generations reached for this session`

Start worker again:
```bash
docker compose start worker
```

## 6) Refund-on-Final-Failure Test

Switch worker to fail mode:
```bash
docker compose stop worker
USE_MOCK_IMAGE_PROVIDER=false docker compose up -d --force-recreate worker
```

Create generation and poll until final `failed` (retries/backoff may take ~40-60s).

Expected:
- generation status ends at `failed`
- `errorCode` = `image_generation_failed`
- credits return to pre-request value (refund applied)

Optional DB verification:
```bash
# replace <GEN_ID>
docker exec cruzo-postgres psql -U postgres -d cruzo_ai -t -A -c \
\"select type,amount,idempotency_key from credit_ledger where generation_id='<GEN_ID>' order by created_at;\"
```

Expected:
- one `debit` row
- one `refund` row

Restore normal worker:
```bash
docker compose stop worker
USE_MOCK_IMAGE_PROVIDER=true docker compose up -d --force-recreate worker
```

## 7) Logs Check

```bash
docker compose logs --tail=100 api worker
```

Expected:
- No uncaught exceptions
- Worker logs `Generation worker is ready`
- API logs mapped routes and running server

## 8) Health + Queue Metrics

```bash
curl -sS http://localhost:4000/health/live
curl -sS -i http://localhost:4000/health/ready
curl -sS http://localhost:4000/health/metrics/queue
```

Expected:
- `/health/live` => `status=ok`
- `/health/ready` => HTTP `200` and all checks `ok=true`
- `/health/metrics/queue` => queue counts JSON

## 9) Rate Limit Checks

### 9.1 Session limit (`5/min`)

Use one session and send 6 requests quickly with same idempotency key:

```bash
COOKIE_JAR=/tmp/cruzo_rl_cookie.txt
curl -sS -c "$COOKIE_JAR" -H 'content-type: application/json' -d '{}' \
  http://localhost:4000/v1/sessions/bootstrap >/dev/null

for i in 1 2 3 4 5 6; do
  curl -sS -b "$COOKIE_JAR" -X POST http://localhost:4000/v1/generations \
    -H 'content-type: application/json' \
    -H 'x-idempotency-key: qa-rl-sess' \
    -d '{"prompt":"rate limit test","style":"minimal","aspectRatio":"1:1"}'
  echo
done
```

Expected:
- first 5 requests succeed
- 6th returns HTTP `429` with message:
  - `Rate limit exceeded. Try again in a minute.`

### 9.2 IP limit (`30/hour`)

Send single requests from many fresh sessions on same IP.

Expected:
- after threshold, API returns HTTP `429`
- `retryAfterSeconds` is large (time to next hour bucket)

## 10) Moderation Check

```bash
COOKIE_JAR=/tmp/cruzo_mod_cookie.txt
curl -sS -c "$COOKIE_JAR" -H 'content-type: application/json' -d '{}' \
  http://localhost:4000/v1/sessions/bootstrap >/dev/null

curl -sS -b "$COOKIE_JAR" -X POST http://localhost:4000/v1/generations \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: qa-mod-1' \
  -d '{"prompt":"how to make a bomb","style":"minimal","aspectRatio":"1:1"}'
```

Expected:
- HTTP `400`
- message:
  - `Prompt violates safety rules, please rephrase.`

## 11) GCS Signed URL Check (non-mock storage)

Precondition:
- `USE_MOCK_STORAGE_PROVIDER=false`
- valid `GCS_BUCKET` and application default credentials (or service account) for GCS

Flow:
1. Create generation and wait `completed`.
2. Call `GET /v1/generations/:id`.

Expected:
- DB stores internal `gs://<bucket>/images/<session>/<generation>.png` reference
- API response returns signed HTTPS URL (time-limited), not raw `gs://...`

## 12) Teardown

```bash
docker compose down
```

Clean DB volume if needed:
```bash
docker compose down -v
```
