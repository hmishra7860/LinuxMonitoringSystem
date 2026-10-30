# LinuxWatch backend

Python **FastAPI** + **PostgreSQL** backend and **psutil** monitoring agent for the LinuxWatch web app.

```
agent (psutil, systemctl, journalctl) ──HTTPS push──▶  FastAPI  ──▶ PostgreSQL
                                                         │  ▲
                              REST + WebSocket ◀─────────┘  └── dashboard (React)
```

## Run it

```bash
cp .env.example .env            # set LW_SECRET_KEY (>= 32 random chars) and POSTGRES_PASSWORD
docker compose up -d --build    # API on http://localhost:8000, interactive docs at /docs
```

Without Docker: create a database, `pip install -r requirements.txt`, export the variables from `.env`, then
`uvicorn app.main:app --port 8000`. The schema (`db/schema.sql`, idempotent) is applied automatically on start.

## Connect a server

1. Register / log in (`POST /api/v1/auth/register`, `/auth/login`), then `POST /api/v1/servers` → the response contains the
   **registration token (`lwt_…`) exactly once**. Only its SHA-256 hash is stored.
2. On the Linux host:
   ```bash
   curl -fsSL http://<api>/api/v1/agent/install.sh | sudo LW_TOKEN=lwt_xxx LW_ENDPOINT=http://<api>/api/v1 bash
   ```
   or run `python3 agent/lw_agent.py --endpoint … --token … --once` to test a single sample.
   **Use HTTPS in production** (put the API behind Caddy/nginx/Traefik with a certificate).

## What it does

| Area | Implementation |
|---|---|
| Auth | scrypt password hashes, signed JWT (12 h, or 30 d with "remember me"), login throttling, personal API tokens (`lwk_…`, scoped, hashed) |
| RBAC | Owner / Admin / Operator / Viewer, enforced per endpoint (`app/deps.py`) and per workspace |
| Ingest | `POST /agent/metrics` validates every field (pydantic), stores time series (`metrics`), latest snapshot (cores, filesystems, interfaces, processes), services, logs |
| Alert engine | `app/services/alerts.py` + pure rules in `app/engine/policy.py`. Policies resolved by specificity (server › tag › env/region › client › default). A threshold fires only when **every sample in the evaluation window** breached and the window is covered by data; auto-resolves when it recovers; escalates warning → critical |
| Offline detection | background job marks silent agents Offline (3× interval, min. `OFFLINE_AFTER_SEC`), records downtime (feeds availability %), raises a critical alert |
| Suppression | scope = server / client / environment / region, per module, 15 m … until manually enabled, reason, full audit trail, auto-expiry. **Metric collection never stops**; alerts are recorded as `suppressed` and notifications held back, and notified when suppression ends if still firing |
| Notifications | Email (SMTP STARTTLS/SSL), Slack, Teams, generic webhook (method, auth, headers, JSON template). Routing rules by severity / module / server / client / environment. Delivery log + status |
| Secrets | integration passwords/webhook URLs encrypted with Fernet, **never returned by the API** (only `secrets: {password: true}`) |
| Real time | WebSocket `/api/v1/ws` — send `{"type":"auth","token":"<jwt>","workspace":"<id>"}` first; receive `server.update`, `alerts.changed`, `deliveries.changed`, `event` |
| Reports | availability, CPU, RAM, disk, alert summary, service availability, incidents — JSON (UI exports CSV/PDF) |
| Housekeeping | retention for metrics/logs/deliveries/events (`METRIC_RETENTION_DAYS`, `LOG_RETENTION_DAYS`) |

## API map (`/api/v1`, full schema at `/docs`)

`auth/*` · `workspaces` · `bootstrap` (one call that hydrates the dashboard) · `servers` (+ `/{id}/metrics`, `/snapshot`, `/logs`, `/services`, `/token/regenerate`) ·
`metrics/fleet` · `alerts` (+ `/{id}/ack|resolve|unsuppress`, `/bulk`, `/simulate`) · `policies` · `suppressions` (+ `/{id}/end`) ·
`integrations` (+ `/test`, `/{id}/test`) · `routing-rules` · `deliveries` · `events` · `reports/{type}?from=&to=` (epoch ms) ·
`settings` · `members` · `tokens` · `audit-log` · agent: `agent/metrics`, `agent/heartbeat`, `agent/install.sh`, `agent/lw_agent.py`.
JSON uses camelCase and epoch-millisecond timestamps, matching the React front-end's data shapes.

## Security notes

* Set a strong `LW_SECRET_KEY`; the API refuses to start otherwise. Terminate TLS in front of the API.
* Webhook/Slack/Teams targets that resolve to private/loopback/link-local addresses are blocked (SSRF) and redirects are not followed. `ALLOW_PRIVATE_WEBHOOKS=true` opts out for internal endpoints. (DNS is checked at validation and send time; a hardened deployment should also egress-filter the API container.)
* Run a **single API worker** — the WebSocket hub and scheduler are in-process. To scale horizontally, move the hub to Redis pub/sub and run the scheduler as one dedicated instance.
* Password-reset e-mail (`/auth/forgot`) is a stub that returns 202; connect it to your SMTP provider before going live.
* `members` invites become active when the invitee registers with the same e-mail.

## Status

The code was written without being able to install the Python dependencies or run PostgreSQL-backed tests in the authoring environment, so it has
**not been executed end to end**. Expect to fix small issues on first run (`docker compose up`, then exercise `/docs`). The SQL schema was applied
successfully to PostgreSQL 16 (twice, to confirm idempotency), and `agent/lw_agent.py` compiles.

## Layout

```
app/main.py            FastAPI app, lifespan (DB pool, schema, scheduler)
app/routers/           core (REST), agent (ingest + installer), ws (WebSocket)
app/services/          business logic per area (alerts, ingest, servers, policies, suppressions, integrations, reports, settings, auth)
app/engine/            pure alert rules (policy.py) and notification senders (notify.py)
app/{db,security,deps,schemas,realtime,jobs,config}.py
db/schema.sql          PostgreSQL schema (idempotent)
agent/                 lw_agent.py, install.sh, agent.ini.example
```
