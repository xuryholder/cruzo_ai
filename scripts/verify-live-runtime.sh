#!/usr/bin/env bash
set -euo pipefail

WEB_URL="${1:-https://cruzo-web-737583534313.us-central1.run.app}"
API_URL="${2:-https://cruzo-api-737583534313.us-central1.run.app}"

echo "[check] api health"
HEALTH_JSON="$(curl -sS "$API_URL/health/live")"
echo "$HEALTH_JSON"

echo "[check] session + token"
SID="$(curl -sS -X POST "$API_URL/v1/live/session" \
  -H 'content-type: application/json' \
  -d '{}' | sed -n 's/.*"liveSessionId":"\([^"]*\)".*/\1/p')"

TOKEN_JSON="$(curl -sS -X POST "$API_URL/v1/live/token" \
  -H "x-live-session-id: $SID" \
  -H 'content-type: application/json' \
  -d '{}')"
echo "$TOKEN_JSON"

echo "[check] live page chunks"
HTML="$(curl -sS "$WEB_URL/live")"
CHUNKS="$(echo "$HTML" | grep -oE '/_next/static/chunks/[a-z0-9]+\.js' | sort -u)"
echo "$CHUNKS"

FOUND_OLD=0
FOUND_NEW=0
for p in $CHUNKS; do
  JS="$(curl -sS "$WEB_URL$p")"
  echo "$JS" | grep -q 'Stop & Edit' && FOUND_OLD=1 || true
  echo "$JS" | grep -q 'Interrupt' && FOUND_NEW=1 || true
done

echo "[result] old_StopAndEdit=$FOUND_OLD new_Interrupt=$FOUND_NEW"

if [[ "$FOUND_NEW" -ne 1 ]]; then
  echo "FAIL: new live controls not detected in served bundle"
  exit 1
fi

if [[ "$FOUND_OLD" -ne 0 ]]; then
  echo "FAIL: old Stop & Edit control still present in served bundle"
  exit 1
fi

echo "PASS"
