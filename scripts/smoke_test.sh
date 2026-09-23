#!/usr/bin/env bash
# laya-hub smoke test: /health -> create an API key -> one real prediction -> clean up.
#
# Inside the backend container (Coolify terminal), everything is already configured:
#     bash /app/scripts/smoke_test.sh
# From elsewhere:
#     BASE_URL=https://api.example.com ADMIN_SECRET=... bash scripts/smoke_test.sh
#
# Env: BASE_URL (default http://localhost:8080), ADMIN_SECRET (required),
#      WAIT_SECONDS (how long to wait for the model to load, default 900), KEEP_KEY=1 to keep the key.
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
BASE_URL="${BASE_URL%/}"
WAIT_SECONDS="${WAIT_SECONDS:-900}"
FAILED=0
KEY_ID=""

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILED=1; }
info() { echo "      $*"; }

# json_get a.b.c  -> prints that field of the JSON on stdin (python3 is always in the backend image)
json_get() {
  python3 -c '
import json, sys
d = json.load(sys.stdin)
for part in sys.argv[1].split("."):
    d = d[part]
print(d)' "$1" 2>/dev/null
}

# request METHOD PATH BODY [HEADER...]  -> sets STATUS and BODY (pass "" for no body)
TMP=$(mktemp)
request() {
  local method=$1 path=$2 data=$3; shift 3
  local args=(-sS -o "$TMP" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json')
  for h in "$@"; do args+=(-H "$h"); done
  [ -n "$data" ] && args+=(--data "$data")
  if STATUS=$(curl "${args[@]}" 2>"$TMP.err"); then BODY=$(cat "$TMP"); else STATUS="000"; BODY=$(cat "$TMP.err"); fi
}

cleanup() {
  if [ -n "$KEY_ID" ] && [ "${KEEP_KEY:-0}" != "1" ]; then
    request DELETE "/admin/keys/$KEY_ID" "" "X-Admin-Secret: $ADMIN_SECRET"
    if [ "$STATUS" = "204" ]; then info "deleted smoke-test key #$KEY_ID"; else info "could not delete key #$KEY_ID (HTTP $STATUS)"; fi
  fi
  rm -f "$TMP" "$TMP.err"
}
trap cleanup EXIT

echo "laya-hub smoke test against $BASE_URL"
if [ -z "${ADMIN_SECRET:-}" ]; then
  fail "ADMIN_SECRET is not set"; exit 1
fi

# 1. Health (waits while the model downloads/loads) ------------------------------------------
deadline=$(( $(date +%s) + WAIT_SECONDS ))
while :; do
  request GET /health ""
  state=$(echo "$BODY" | json_get status)
  if [ "$STATUS" = "200" ]; then
    pass "GET /health -> model loaded: $(echo "$BODY" | json_get models)"
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    fail "GET /health -> still not ready after ${WAIT_SECONDS}s (HTTP $STATUS: $BODY)"; exit 1
  fi
  info "model not ready yet (HTTP $STATUS, status=${state:-unreachable}); retrying in 10s..."
  last_error=$(echo "$BODY" | json_get error)
  [ -n "$last_error" ] && [ "$last_error" != "None" ] && info "last load error: ${last_error:0:300}"
  sleep 10
done
MODELS=$(echo "$BODY" | json_get models)

# 2. Admin: create a key ----------------------------------------------------------------------
request POST /admin/keys "{\"name\": \"smoke-test $(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"rate_limit_per_min\": 10}" \
  "X-Admin-Secret: $ADMIN_SECRET"
if [ "$STATUS" = "201" ]; then
  KEY=$(echo "$BODY" | json_get key)
  KEY_ID=$(echo "$BODY" | json_get id)
  pass "POST /admin/keys -> created key #$KEY_ID (${KEY:0:11}...)"
else
  fail "POST /admin/keys -> HTTP $STATUS: $BODY"; exit 1
fi

# 3. Auth is enforced ------------------------------------------------------------------------
request POST /v1/systemone '{"state": "hi", "questions": {"q": {"type": "noul", "instructions": "?"}}}'
if [ "$STATUS" = "401" ]; then pass "POST /v1/systemone without a key -> 401"; else fail "no-key request returned HTTP $STATUS (expected 401)"; fi

# 4. One real prediction ---------------------------------------------------------------------
PREDICTION='{
  "state": {"message": "I was charged twice for my subscription this month. Please refund the duplicate today, this is really annoying."},
  "questions": {
    "intent": {"type": "choice", "instructions": "What does the customer want in `message`?",
               "criteria": {"refund": "money returned or a duplicate charge reversed",
                            "technical_help": "a bug, outage or integration problem",
                            "information": "general information, pricing or how-to"}},
    "is_urgent": {"type": "noul", "instructions": "Does `message` communicate time pressure or a deadline?"},
    "frustration": {"type": "score", "instructions": "How frustrated does the customer sound in `message`?",
                    "criteria": ["calm", "concerned but civil", "clearly annoyed", "very angry"]}
  }
}'
start=$(date +%s%N)
request POST /v1/systemone "$PREDICTION" "Authorization: Bearer $KEY"
ms=$(( ($(date +%s%N) - start) / 1000000 ))
if [ "$STATUS" = "200" ]; then
  choice=$(echo "$BODY" | json_get answers.intent.choice)
  pass "POST /v1/systemone -> HTTP 200 in ${ms} ms, served by $(echo "$BODY" | json_get routing.served_by)"
  info "intent=$choice  is_urgent=$(echo "$BODY" | json_get answers.is_urgent.noul)  frustration=$(echo "$BODY" | json_get answers.frustration.score)"
  if [ "$choice" = "refund" ]; then pass "intent answered 'refund' as expected"; else fail "intent answered '$choice' (expected 'refund')"; fi
  echo "----- raw response -----"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  echo "------------------------"
else
  fail "POST /v1/systemone -> HTTP $STATUS: $BODY"
fi

# 5. Unloaded-model policy (only meaningful when 'multilingual' is not loaded) ----------------
if [[ "$MODELS" != *multilingual* ]]; then
  request POST /v1/systemone '{"state": "Mein Konto wurde zweimal belastet. Bitte erstatten Sie mir den doppelten Betrag zurück, das ärgert mich sehr.", "questions": {"q": {"type": "noul", "instructions": "Does the customer ask for a refund?"}}}' \
    "Authorization: Bearer $KEY"
  if [ "$STATUS" = "422" ]; then
    pass "German text with no multilingual model -> 422 (UNLOADED_MODEL_POLICY=reject)"
  elif [ "$STATUS" = "200" ] && [ "$(echo "$BODY" | json_get warning)" = "language_mismatch" ]; then
    pass "German text -> 200 with warning=language_mismatch (UNLOADED_MODEL_POLICY=fallback)"
  else
    fail "German text returned HTTP $STATUS: $BODY"
  fi
fi

echo
if [ "$FAILED" = "0" ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$FAILED"
