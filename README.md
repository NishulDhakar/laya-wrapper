# laya-hub

A self-hosted API (and, soon, an admin dashboard) on top of the open-source
[Laya](https://github.com/NandhaKishorM/laya) decision model.

Laya answers **typed decisions** about a piece of text in one forward pass: `choice` (pick one
label), `score` (a level on an ordered scale) and `noul` (a calibrated yes/no probability). It does
**not** generate text. laya-hub wraps it with API keys, per-key rate limits, request logging and
usage stats, and runs on a small CPU-only VPS.

> Built on Laya by Convai Innovations (Apache 2.0). Laya is used only as a pip dependency.

**Status:** backend done. The Next.js dashboard is step 2 and will be added to the same
`docker-compose.yml`.

---

## Deploy on Coolify

The repo contains a `docker-compose.yml`. No host ports are published (Coolify already uses 8000):
the backend listens on port 8080 **inside** the Docker network only.

1. **New resource → Public/Private repository** → pick this repo.
2. Build configuration:

   | Field | Value |
   |---|---|
   | Branch | `main` |
   | Build pack | **Docker Compose** |
   | Base directory | `/` |
   | Docker Compose location | `/docker-compose.yml` |

3. **Environment variables**: set at least `ADMIN_SECRET` (e.g. `openssl rand -hex 32`). Every
   variable is documented in [`.env.example`](.env.example); the defaults fit an 8 GB / 4 vCPU VPS.
4. **Domains**: leave the `backend` service **without** a domain (in step 2 only the dashboard gets
   one).
5. **Deploy.** The first boot downloads the English checkpoint (~1.7 GB) into the `models` volume,
   which takes a few minutes; `/health` returns 503 (`"status": "loading"`) until it is ready.
   Failed downloads are retried automatically with backoff. Later restarts load from the volume.

Resources: the backend is capped at `mem_limit: 3g` and runs a single uvicorn worker (each worker
would hold its own model copy). Data lives in two named volumes: `models` (Hugging Face cache,
`HF_HOME=/models`) and `data` (SQLite at `/data/hub.db`).

### Smoke test (run inside the backend container)

`scripts/smoke_test.sh` checks `/health` (waiting while the model loads), creates a temporary API
key through the admin API, checks that a request without a key gets 401, runs **one real
prediction**, checks that German text is rejected when only the English model is loaded, then
deletes the key. It prints `PASS`/`FAIL` lines and the raw prediction JSON.

**From the Coolify UI:** open the application → **Terminal** → choose the `backend` container →
run:

```bash
bash /app/scripts/smoke_test.sh
```

`ADMIN_SECRET` is already in the container's environment, so no arguments are needed.

**Over SSH on the VPS** (equivalent):

```bash
docker ps --format '{{.Names}}' | grep backend        # find the container name
docker exec -it <backend-container-name> bash /app/scripts/smoke_test.sh
```

### Optional: expose `/v1` on its own domain

If other services outside this server should call the API directly:

1. In Coolify, give the `backend` service a domain **with the container port**, e.g.
   `https://laya-api.example.com:8080`, and redeploy.
2. Only `/v1/*` and `/health` are usable through that domain. Requests to `/admin/*` that arrive
   through Coolify's proxy (they always carry `X-Forwarded-For`) are refused with 403, so the admin
   API stays internal even though the backend is public. (`ALLOW_ADMIN_VIA_PROXY=true` disables this
   protection; don't set it unless you have a reason.)
3. API keys and per-key rate limits protect `/v1`. To make the backend private again, remove the
   domain.

---

## API

All `/v1` calls need `Authorization: Bearer <key>` (keys look like `lk_` + 48 hex chars; only their
SHA-256 hash is stored).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/systemone` | API key | `{state, questions[, model]}` → `answers`, `routing`, `usage` |
| POST | `/v1/presets/{triage\|guard\|moderation\|router}` | API key | `{state}` with Laya's preset questions |
| GET | `/health` | none | 200 when the model is loaded, 503 while loading |
| POST/GET/PATCH/DELETE | `/admin/keys[/{id}]` | `X-Admin-Secret` | manage keys |
| GET | `/admin/usage?days=7` (or `start`/`end`) | `X-Admin-Secret` | per-key and per-day stats |
| GET | `/admin/logs?limit=100` | `X-Admin-Secret` | recent calls (no bodies unless `LOG_REQUEST_BODIES=true`) |
| POST | `/admin/playground` | `X-Admin-Secret` | a prediction without an API key |

Question rules (400 with a clear message otherwise):

- `choice`: `criteria` is a dict `label → description` (description may be `null`) or a list of
  labels; 2 to `MAX_CHOICE_OPTIONS` (default 10) unique options. Confidence is only calibrated up to
  10 options; if you raise the cap, larger questions get `"warning": "uncalibrated_confidence"`.
- `score`: `criteria` is a list of at least 2 level descriptions, lowest first.
- `noul`: `criteria` is optional; if given it must have exactly the keys `"false"` and `"true"`.
  Optional `labels` must also have exactly `"false"`/`"true"` with distinct, non-empty values.
- **Avoid yes/no/true/false as choice labels.** Laya can follow the label word instead of its
  description. Such requests still work but are flagged in the server log and the call log
  (`boolean_like_choice_labels`). Use a `noul` question, or descriptive labels.
- At most `MAX_QUESTIONS` (20) questions and `MAX_STATE_BYTES` (20 KB) of state per request.

Language routing: Laya routes non-English text to its `multilingual` checkpoint. If that
checkpoint is not loaded, the default `UNLOADED_MODEL_POLICY=reject` returns **422** ("text routed
to 'multilingual', which is not loaded on this server"), because the English checkpoint gives
confidently wrong answers on non-English text. `fallback` runs it anyway and adds
`"warning": "language_mismatch"` to the response and the call log.

Example (from inside the Docker network; replace the host if you exposed `/v1`):

```bash
curl -s http://backend:8080/v1/systemone \
  -H "Authorization: Bearer $LAYA_KEY" -H "Content-Type: application/json" \
  -d '{"state": {"message": "I was charged twice, please refund me"},
       "questions": {"refund": {"type": "noul", "instructions": "Does `message` ask for money back?"}}}'
```

---

## Local development (without Docker)

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt
pytest                                   # uses a fake Laya router; no model download

export ADMIN_SECRET=dev-secret DATABASE_URL=sqlite:///./hub.db HF_HOME=~/.cache/huggingface
uvicorn app.main:create_app --factory --port 8080 --workers 1
ADMIN_SECRET=dev-secret bash ../scripts/smoke_test.sh
```

## Local development (with Docker)

```bash
cp .env.example .env                     # set ADMIN_SECRET
docker compose up --build
docker compose exec backend bash /app/scripts/smoke_test.sh
```

## License & credit

Built on Laya by Convai Innovations (Apache 2.0).
