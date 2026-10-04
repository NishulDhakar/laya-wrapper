# laya

A self-hosted API and admin dashboard on top of the open-source
[Laya](https://github.com/NandhaKishorM/laya) decision model.

Laya answers **typed decisions** about a piece of text in one forward pass: `choice` (pick one
label), `score` (a level on an ordered scale) and `noul` (a calibrated yes/no probability). It does
**not** generate text. laya-hub wraps it with API keys, per-key rate limits, request logs, usage
stats and a dashboard, and runs on a small CPU-only VPS.

> Built on Laya by Convai Innovations (Apache 2.0). Laya is used only as a pip dependency.

```
 internet ──► Coolify proxy ──► dashboard (Next.js, :3000)  ── login, keys, usage, logs, playground
                                    │  server-side only, X-Admin-Secret
                                    ▼
                                 backend (FastAPI, :8080)  ── /v1 (API keys) · /admin (internal) · /health
                                    │
                         volumes:  models (HF cache) · data (SQLite)
```

- `backend/` — Python 3.11, FastAPI, SQLAlchemy (SQLite by default), Laya on CPU torch.
- `dashboard/` — Next.js (App Router), TypeScript, Tailwind, Recharts.
- `clients/` — tiny Python and TypeScript clients with a `decide(state, questions)` function.
- `scripts/smoke_test.sh` — end-to-end check of a running backend.

---

## Deploy on Coolify

`docker-compose.yml` defines both services. No host ports are published (Coolify already uses
8000); Coolify's proxy routes the dashboard's domain to it, and the backend stays on the internal
network.

1. **New resource → Public/Private repository** → pick this repo.
2. Build configuration:

   | Field | Value |
   |---|---|
   | Branch | `main` |
   | Build pack | **Docker Compose** |
   | Base directory | `/` |
   | Docker Compose location | `/docker-compose.yml` |

3. **Environment variables** (all documented in [`.env.example`](.env.example)):
   - `ADMIN_SECRET` — required; shared by backend and dashboard (`openssl rand -hex 32`).
   - `ADMIN_PASSWORD` — required; the dashboard login password.
   - Everything else has defaults that fit an 8 GB / 4 vCPU VPS.
4. **Domains**:
   - `dashboard` → your domain **with the container port**, e.g. `https://hub.example.com:3000`.
   - `backend` → **no domain** (see [Expose `/v1`](#optional-expose-v1-on-its-own-domain) if you want
     one).
5. **Deploy.** The first boot downloads the English checkpoint (~1.7 GB) into the `models` volume;
   the backend's `/health` returns 503 (`"status": "loading"`) until it is ready, and the dashboard
   shows "Model loading…" meanwhile. Failed downloads retry with backoff. Later restarts load from the
   volume and warm the model up before reporting ready.

Resources: the backend has `mem_limit: 3g` and a single uvicorn worker (each worker would hold its
own model copy); the dashboard has `mem_limit: 512m`. Data lives in the named volumes `models`
(`HF_HOME=/models`) and `data` (`/data/hub.db`).

### Smoke test (inside the backend container)

`scripts/smoke_test.sh` checks `/health` (waiting while the model loads), creates a temporary API
key, checks that a request without a key gets 401, runs **one real prediction**, checks that German
text is rejected while only the English model is loaded, then deletes the key. It prints
`PASS`/`FAIL` lines and the raw prediction.

In Coolify: application → **Terminal** → `backend` container →

```bash
bash /app/scripts/smoke_test.sh
```

Over SSH: `docker exec -it <backend-container> bash /app/scripts/smoke_test.sh`.

### Optional: expose `/v1` on its own domain

For services outside this server that should call the API directly:

1. Give the `backend` service a domain with its port, e.g. `https://laya-api.example.com:8080`, and
   redeploy.
2. Only `/v1/*` and `/health` are usable through that domain: `/admin/*` requests that arrive through
   Coolify's proxy (they always carry `X-Forwarded-For`) are refused with 403, so the admin API stays
   internal. (`ALLOW_ADMIN_VIA_PROXY=true` turns that off — don't, unless you must.)
3. Callers authenticate with API keys created in the dashboard. Remove the domain to make the backend
   private again.

---

## Dashboard

Single-user login (`ADMIN_PASSWORD`) with a signed, `httpOnly`, `SameSite=Lax` session cookie
(`Secure` automatically whenever the dashboard is served over https). All backend calls happen in server components and server actions; the
admin secret never reaches the browser.

- **Overview** — calls today / 7 days, average and p95 latency, error rate, calls-per-day and
  latency charts, model status.
- **API keys** — one key per project or client, each with its own rate limit. The full key is shown
  **once** with a copy button (only its SHA-256 hash is stored). Rename, change the rate limit,
  deactivate/activate, delete.
- **Usage** — last 7/30/90 days or a custom UTC date range; per-day and per-key charts and a per-key
  table (calls, errors, error rate, average and p95 latency).
- **Logs** — recent calls filtered by key: time, key, endpoint, status, latency, model, number of
  questions, warnings and errors. Request bodies only if `LOG_REQUEST_BODIES=true`.
- **Playground** — paste text (or JSON), build `choice` / `score` / `noul` questions, run, and see
  answers as confidence bars plus the raw JSON. Templates: support triage, prompt-injection guard,
  yes/no check. Calls are logged as "playground".

Light and dark mode follow the OS until you pick one with the toggle.

---

## API

`/v1` calls need `Authorization: Bearer <key>` (keys look like `lk_` + 48 hex chars).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/systemone` | API key | `{state, questions[, model]}` → `answers`, `routing`, `usage` |
| POST | `/v1/presets/{triage\|guard\|moderation\|router}` | API key | `{state}` with Laya's preset questions |
| GET | `/health` | none | 200 when the model is loaded, 503 while loading |
| POST/GET/PATCH/DELETE | `/admin/keys[/{id}]` | `X-Admin-Secret` | manage keys |
| GET | `/admin/usage?days=7` (or `start`/`end`) | `X-Admin-Secret` | per-key and per-day stats |
| GET | `/admin/logs?limit=100[&key_id=]` | `X-Admin-Secret` | recent calls |
| POST | `/admin/playground` | `X-Admin-Secret` | a prediction without an API key |

Errors are JSON: `{"error": {"code", "message", "details"?}}` — 400 invalid request, 401 bad key,
403 deactivated key, 413 body too large, 422 text routed to a model that isn't loaded, 429 rate
limited (with `Retry-After`), 503 model loading or server busy.

For presets, a plain-string `state` is wrapped under the key the preset's instructions use:
`message` (triage), `prompt` (guard), `post` (moderation), `request` (router).

### Question rules

- `choice`: `criteria` is a dict `label → description` (description may be `null`) or a list of
  labels; 2 to `MAX_CHOICE_OPTIONS` (default **10**) unique options. Confidence is only calibrated up
  to 10 options; if you raise the cap, those answers carry `"warning": "uncalibrated_confidence"`.
- `score`: `criteria` is a list of at least 2 level descriptions, lowest first. `score` in the answer
  is the expected level.
- `noul`: `criteria` is optional; if given it must have exactly the keys `"false"` and `"true"`.
  Optional `labels` must also have exactly `"false"`/`"true"`, with distinct non-empty values.
- **Avoid yes/no/true/false as choice labels** — Laya can follow the label word instead of its
  description. Such requests still work but are flagged in the server log and the call log
  (`boolean_like_choice_labels`); the Playground warns as you type. Use a `noul` question or
  descriptive labels instead.
- At most `MAX_QUESTIONS` (20) questions and `MAX_STATE_BYTES` (20 KB) of state per request.
- Question names: letters, digits and `_`, up to 64 characters.

### Language routing

Laya routes non-English text to its `multilingual` checkpoint. If that checkpoint is not loaded
(the default `LAYA_MODELS=english`), the default `UNLOADED_MODEL_POLICY=reject` returns **422**
(`text routed to 'multilingual', which is not loaded on this server`), because the English
checkpoint gives confidently wrong answers on non-English text. `fallback` runs it anyway, adds
`"warning": "language_mismatch"` to the response and logs it. Loading `multilingual` as well needs
more than the default 3 GB memory limit.

### Examples

The base URL is `http://backend:8080` from other containers on the same Coolify network, or your
backend domain if you exposed `/v1`.

**curl**

```bash
curl -s "$LAYA_HUB_URL/v1/systemone" \
  -H "Authorization: Bearer $LAYA_HUB_KEY" -H "Content-Type: application/json" \
  -d '{
    "state": {"message": "I was charged twice, please refund me today"},
    "questions": {
      "intent": {"type": "choice", "instructions": "What does the customer want in `message`?",
                 "criteria": {"refund": "money back", "technical_help": "a bug or outage", "other": "anything else"}},
      "is_urgent": {"type": "noul", "instructions": "Does `message` mention a deadline?"}
    }
  }'
```

**Python (httpx)**

```python
import httpx

res = httpx.post(
    f"{LAYA_HUB_URL}/v1/systemone",
    headers={"Authorization": f"Bearer {LAYA_HUB_KEY}"},
    json={
        "state": {"message": "I was charged twice, please refund me today"},
        "questions": {"is_urgent": {"type": "noul", "instructions": "Does `message` mention a deadline?"}},
    },
    timeout=60,
)
res.raise_for_status()
print(res.json()["answers"]["is_urgent"]["noul"])   # probability of "true"
```

Or with the bundled client, [`clients/python/laya_hub_client.py`](clients/python/laya_hub_client.py):

```python
from laya_hub_client import decide   # reads LAYA_HUB_URL / LAYA_HUB_KEY
result = decide({"message": "..."}, {"is_urgent": {"type": "noul", "instructions": "..."}})
```

**TypeScript (fetch)**

```ts
const res = await fetch(`${process.env.LAYA_HUB_URL}/v1/systemone`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LAYA_HUB_KEY}` },
  body: JSON.stringify({
    state: { message: "I was charged twice, please refund me today" },
    questions: { is_urgent: { type: "noul", instructions: "Does `message` mention a deadline?" } },
  }),
});
if (!res.ok) throw new Error((await res.json()).error.message);
const { answers } = await res.json();
```

Or with [`clients/ts/lahub.ts`](clients/ts/lahub.ts): `await decide(state, questions, { baseUrl, apiKey })`.
Call laya-hub from your server — never ship an API key to a browser.

---

## Local development

### Without Docker

Backend (terminal 1):

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt
pytest                                    # fake Laya router; no model download

export ADMIN_SECRET=dev-secret DATABASE_URL=sqlite:///./hub.db HF_HOME=~/.cache/huggingface
uvicorn app.main:create_app --factory --port 8080 --workers 1
ADMIN_SECRET=dev-secret bash ../scripts/smoke_test.sh
```

Dashboard (terminal 2):

```bash
cd dashboard
npm install
BACKEND_URL=http://localhost:8080 ADMIN_SECRET=dev-secret ADMIN_PASSWORD=dev npm run dev
# open http://localhost:3000
npm run lint && npm run typecheck && npm run build
```

### With Docker

```bash
cp .env.example .env                      # set ADMIN_SECRET and ADMIN_PASSWORD
docker compose up --build
docker compose exec backend bash /app/scripts/smoke_test.sh
```

No ports are published to the host; to open the dashboard locally, add a temporary override:

```yaml
# docker-compose.override.yml (local only, don't commit)
services:
  dashboard:
    ports: ["3000:3000"]
```

---

## Moving to Postgres / Supabase

The database layer is isolated in `backend/app/db.py` and only uses SQLAlchemy. Set
`DATABASE_URL=postgresql+psycopg://user:pass@host:5432/db` and add `psycopg[binary]` to
`backend/requirements.txt`. Tables are created with `create_all` on startup; for schema changes
after that, add Alembic.

## License & credit

Built on Laya by Convai Innovations (Apache 2.0).
