# laya-wrapper

**A self-hosted inference gateway for the open-source [Laya](https://github.com/) decision model, with API keys, per-key rate limiting, usage analytics and an admin dashboard. Runs on a single CPU-only VPS.**

<!-- Add: dashboard screenshot here (Overview page with p95 + calls/day charts) -->

Laya answers typed decisions about a piece of text in one forward pass. It does not generate text:

- **choice**: pick one label (for example, intent routing)
- **score**: a level on an ordered scale (for example, urgency 1–5)
- **noul**: a calibrated yes/no probability (for example, "is this a prompt injection?")

A model on its own isn't a service. laya-hub turns it into one that other apps can call safely and that can be operated and monitored.

---

## Why I built it

I wanted cheap, fast, deterministic classification (triage, moderation, prompt-injection guarding, routing) without paying LLM token costs for every yes/no question. The model existed, but there was no auth, no rate limiting, no visibility into latency or errors, and no safe way to expose it. laya-hub fills that gap.

## Architecture

```
internet ──► Coolify proxy ──► dashboard (Next.js :3000)
                                 │  login · keys · usage · logs · playground
                                 │  server-side only, X-Admin-Secret
                                 ▼
                          backend (FastAPI :8080)
                                 │  /v1 (API keys) · /admin (internal) · /health
                                 ▼
                 volumes: models (HF cache, ~1.7 GB) · data (SQLite)
```

| Layer | Tech |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy, Laya on CPU PyTorch |
| Dashboard | Next.js (App Router), TypeScript, Tailwind, Recharts |
| Storage | SQLite by default; swap to Postgres or Supabase with one env var |
| Deploy | Docker Compose on Coolify (8 GB / 4 vCPU VPS) |
| Clients | Small Python and TypeScript `decide(state, questions)` clients |

## Engineering decisions

| Decision | Why |
|---|---|
| **One uvicorn worker, `mem_limit: 3g`** | Each worker would load its own copy of the model. One worker keeps memory predictable on a small VPS. |
| **`/health` returns 503 while the model loads** | The first boot downloads about 1.7 GB. Callers and the proxy get an honest "not ready" instead of timeouts. Downloads retry with backoff, and restarts warm the model before reporting ready. |
| **API keys stored as SHA-256 hashes** | The full key is shown once at creation. A database leak doesn't leak usable keys. |
| **Per-key rate limits, 429 with `Retry-After`** | One noisy client can't starve the others. |
| **`/admin/*` refused through the public proxy (403)** | Requests carrying `X-Forwarded-For` can't reach admin routes, so the admin API stays internal-only. |
| **Admin secret never reaches the browser** | All dashboard→backend calls run in server components and server actions. Sessions use httpOnly, SameSite=Lax cookies, marked Secure over HTTPS. |
| **Language-routing policy (422 by default)** | The English checkpoint gives *confidently wrong* answers on non-English text, so the default is to reject rather than return silent garbage. A `fallback` mode exists, which adds a `language_mismatch` warning. |
| **Guards on input** | Max 20 questions, 20 KB of state, and calibrated confidence only up to 10 choice options (beyond that, answers are flagged `uncalibrated_confidence`). Yes/no-style choice labels are detected and flagged, because the model follows the label word instead of its description. |
| **Consistent error contract** | `{"error": {"code", "message", "details"}}`: 400 / 401 / 403 / 413 / 422 / 429 / 503. |

## Features

- **Overview**: calls today and over 7 days, average and **p95 latency**, error rate, calls-per-day and latency charts, model status
- **API keys**: one per client, each with its own rate limit; rename, deactivate or delete
- **Usage**: 7/30/90-day or custom ranges, per-key error rate and p95
- **Logs**: per-call status, latency, model, warnings (request bodies only if opted in)
- **Playground**: build choice/score/noul questions and see confidence bars plus raw JSON. Includes templates for **support triage**, **prompt-injection guard** and **yes/no checks**.

## API

`/v1` requires `Authorization: Bearer lk_<48 hex>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/systemone` | API key | `{state, questions}` → answers, routing, usage |
| POST | `/v1/presets/{triage\|guard\|moderation\|router}` | API key | Built-in question sets |
| GET | `/health` | none | 200 when ready, 503 while loading |
| * | `/admin/keys`, `/admin/usage`, `/admin/logs`, `/admin/playground` | `X-Admin-Secret` | Internal management |

```bash
curl -s "$LAYA_HUB_URL/v1/systemone" \
  -H "Authorization: Bearer $LAYA_HUB_KEY" -H "Content-Type: application/json" \
  -d '{
    "state": {"message": "I was charged twice, please refund me today"},
    "questions": {
      "intent":    {"type": "choice", "instructions": "What does the customer want in `message`?",
                    "criteria": {"refund": "money back", "technical_help": "a bug or outage", "other": "anything else"}},
      "is_urgent": {"type": "noul", "instructions": "Does `message` mention a deadline?"}
    }
  }'
```

```python
from laya_hub_client import decide   # reads LAYA_HUB_URL / LAYA_HUB_KEY
result = decide({"message": "..."}, {"is_urgent": {"type": "noul", "instructions": "..."}})
```

## Performance

<!-- Fill these in from your dashboard. Real numbers only. -->

| Metric (CPU-only, 4 vCPU) | Value |
|---|---|
| p50 latency | _TODO_ ms |
| p95 latency | _TODO_ ms |
| Cold start (first download) | _TODO_ |
| Warm restart to ready | _TODO_ |
| Backend memory at steady state | _TODO_ GB |

## Testing

- `pytest` runs against a **fake Laya router**, so no model download is needed in CI.
- `scripts/smoke_test.sh` runs an end-to-end check against a live backend. It waits for health, creates a temporary key, verifies a 401 without a key, runs a real prediction, verifies non-English text is rejected, then deletes the key.

```bash
docker compose exec backend bash /app/scripts/smoke_test.sh
```

## Run locally

```bash
cp .env.example .env          # set ADMIN_SECRET and ADMIN_PASSWORD
docker compose up --build
```

<details>
<summary>Without Docker</summary>

```bash
# backend
cd backend && python3.11 -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt && pytest
ADMIN_SECRET=dev-secret DATABASE_URL=sqlite:///./hub.db \
  uvicorn app.main:create_app --factory --port 8080 --workers 1

# dashboard
cd dashboard && npm install
BACKEND_URL=http://localhost:8080 ADMIN_SECRET=dev-secret ADMIN_PASSWORD=dev npm run dev
```
</details>

<details>
<summary>Deploy on Coolify</summary>

Build pack: **Docker Compose**, file `/docker-compose.yml`, branch `main`. Required env vars are `ADMIN_SECRET` (`openssl rand -hex 32`) and `ADMIN_PASSWORD`; everything else has defaults that fit an 8 GB / 4 vCPU VPS. Give the dashboard a domain. Leave the backend without a domain unless external services need `/v1` (admin routes stay blocked through the proxy either way).
</details>

## Limitations and next steps

- Single worker means throughput is bounded by one model instance. The next step is a request queue with batching.
- SQLite is fine for one node. Moving to Postgres needs `DATABASE_URL` plus Alembic migrations.
- Rate limits are in-process. Running multiple instances would need Redis-backed limits.
- Only the English checkpoint is loaded by default; loading the multilingual one needs more than 3 GB.

## Credit

Built on [Laya](https://github.com/) by Convai Innovations (Apache 2.0), used as a pip dependency.
