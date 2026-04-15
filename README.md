# GPU Network v1

Community GPU network inspired by Salad Cloud and Vast.ai. Saudi-Arabia-based v1 targets 5–7 users and 2 GPU nodes as a trusted-friends launch, with architecture designed so it can later open to untrusted public contributors without a rewrite.

## Status

**v1 Must scope shipped.** All 14 Must stories across Sprints 0–4 are implemented, tested, and on `main` (local — no remote yet). End-to-end flow works:

- A user signs up, an admin grants access, the user generates an API key.
- A host registers a node with a one-time claim token; the node-agent daemon heartbeats, claims queued jobs, runs them via Docker, streams logs, and reports completion.
- A renter submits a job (Docker image + cmd + GPU count), watches its status, streams logs, and can cancel mid-run.
- A host can drain or disconnect a node cleanly.
- An admin sees the platform dashboard (users / nodes / jobs / GPU-hours) and can force-kill any job or force-drain any node.
- Prometheus telemetry covers HTTP traffic, job/node state, and per-GPU utilization / memory / temperature.

178 tests pass; cold `docker compose up --build` reaches a green `/health` in ~12 seconds.

## Quick start

```bash
docker compose up --build
# Control plane:  http://localhost:8000
# Swagger UI:     http://localhost:8000/docs
# Prometheus:     http://localhost:8000/metrics
# Run tests:      docker compose exec -T control-plane pytest -v
# Node agent:     cd node-agent && go build ./... && go test ./...
```

**Docker only.** No local Python venv, not even for syntax checks — project rule.

## Repo layout

```
control-plane/      Python + FastAPI + Postgres (layered: controllers → services → repos → models)
node-agent/         Go single-binary worker daemon (init / start / status / version)
docker-compose.yml  Local dev stack
ONBOARDING.md       Sprint 1 handoff guide — code conventions and gotchas (still useful)
INSTRUCTIONS.md     Sprint 2–4 one-shot instructions
```

## Where design lives

- **Miro board:** https://miro.com/app/board/uXjVGkF381g=/
- **User stories table** — 22 stories (Renter R1–R9, Host H1–H7, Operator O1–O6)
- **Build-order dependency graph** — Sprint 0 → 4 mapping
- **v1 System Architecture** — 3 clusters (end users, control plane, host machine)
- **Story Contract template** — Definition of Ready rule
- Story contracts for R1, O6, O5, R2, H2 (Sprint 0–1 retrospective gold-standard)

Sprint 2–4 stories shipped without contracts-first; retrospective diagrams on Miro are optional follow-up per `INSTRUCTIONS.md` §8.

## Architectural decisions locked in

- **Path B — Salad-style pull-based worker agents.** Workers always initiate HTTPS out to the control plane; no inbound ports on the host. Plain Docker on the worker, *not* k8s.
- **Model 1 — one account, multi-role.** A user is renter, host, or both; `can_rent` and `can_host` flags on the user row.
- **Invite-only launch.** New users land with `status='pending'`; an admin grants access via O6 before they can submit jobs or host.
- **Three auth identities, three code paths.**
  - User: JWT (`/api/auth/login`) or API key (`gpuk_…`) — `get_current_user`.
  - Agent: per-node bearer token (`gpuagent_…`) issued at registration — `get_current_node`. Distinct from user auth; never interchangeable.
  - Admin: any active user with `is_admin=true` — `require_admin`.
- **Scheduler:** FIFO with `SELECT … FOR UPDATE SKIP LOCKED` so concurrent agents never claim the same job; respects per-node GPU capacity and skips draining nodes.
- **Billing:** GPU-hours billed at job completion via `_bill_gpu_hours(started_at, completed_at, gpu_count)` — rounds up to a 1-hour minimum, clamps user credits at 0.
- **Computed node status:** `online` / `offline` derived from `last_seen_at` (60s threshold) on every read; `draining` is a stored sticky state.
- **Stack:** Python 3.12 + FastAPI + Postgres + async SQLAlchemy + Alembic + pytest-asyncio (NullPool on the engine) · Go 1.22 for node agent · bcrypt directly (not passlib) · prometheus-client.

## Session output (handoff)

### Shipped this session — Sprint 2 → Sprint 4

**14 commits on `main` (local only, no remote).** Latest first:

```
238e058  O3: implement admin force-kill and force-drain
20e3834  O1: implement admin ops dashboard
b847c5f  H7: implement clean node disconnect
dcca94a  H6: implement node drain and undrain
047add2  R7: implement user job cancellation
016f25c  R6: implement batched job log push and polled read
06439aa  R5: implement job list and detail endpoints
442798b  O2: implement Prometheus telemetry and agent metrics push
339b007  feat: scheduler endpoints + node-agent daemon loop
c944bba  H3: implement node detail, heartbeat, and agent auth
6bc3a6a  R4: implement user job submission
7bfc5ea  docs: add INSTRUCTIONS for Sprint 2-4 one-shot
c0ec0dd  H2: implement claim token + node registration   (Sprint 1)
a606860  R2: implement user API keys                      (Sprint 1)
4b0f65f  O5: implement admin audit log view               (Sprint 1)
f240dfc  O6: implement admin grant access                 (Sprint 1)
3ecea38  implement R1: signup, login, /me + audit log + alembic   (Sprint 0)
ca1f10a  initial scaffold                                 (Sprint 0)
```

**Code — what's new this session**

- 5 Alembic migrations: `0005_r4_jobs`, `0006_h3_node_agent_token`, `0007_o2_node_metrics`, `0008_r6_job_logs`, `0009_r7_job_cancel`.
- New tables: `jobs`, `job_logs`, `node_metrics`. New columns: `nodes.agent_token_hash`, `nodes.agent_token_prefix`, `jobs.cancel_requested_at`.
- New endpoints (~22): job submit/list/detail/cancel/claim/complete, job logs push/read, node detail/heartbeat/drain/undrain/delete, agent metrics push, admin dashboard, admin force-kill, admin force-drain, `/metrics` exposition.
- New service modules: `app/services/job_service.py`, `app/services/job_status.py` (state-machine rules), `app/services/node_status.py` (online/offline computation), `app/observability.py` (Prometheus instrumentation), and assorted repos.
- Node-agent daemon implemented end-to-end: heartbeat → claim → docker run → complete, with cancel-on-heartbeat and SIGINT shutdown. `cmd/start.go` is wired.

**Tests — 178 passing**

```
control-plane/tests/controllers/
  test_admin.py                17  R1/O6
  test_admin_audit.py          15  O5
  test_admin_dashboard.py       7  O1
  test_admin_force_ops.py      11  O3
  test_api_keys.py             13  R2
  test_auth.py                 10  R1
  test_job_cancel.py           10  R7
  test_job_logs.py             11  R6
  test_jobs.py                 19  R4 + R5
  test_metrics.py              10  O2
  test_node_delete.py           7  H7
  test_node_drain.py            9  H6
  test_nodes.py                25  H2 + H3
  test_scheduler.py            14  scheduler / claim / complete
node-agent/internal/
  agent/daemon_test.go          2  daemon loop + claim+complete
  config/config_test.go         4
  gpu/detect_test.go            6
```

**No new memory entries** — no surprises beyond the gotchas already captured in `INSTRUCTIONS.md` §9.

### What's NOT shipped (deferred)

- **Should-have stories** — R3 (job priority), R8 / R9 (cost dashboard, retries), H4 / H5 (per-node pricing), O4 (rate limits). Not in scope for v1 Musts.
- **Frontend / UI** — backend-only; Swagger at `/docs` is the visible surface.
- **Public installer / hosted agent script** — agents install via `gpu-agent init --control-plane=… --claim-token=…` with the binary built from source.
- **GitHub remote** — repo stays local for v1.
- **Retrospective Miro diagrams for the 10 Sprint 2–4 stories** — `INSTRUCTIONS.md` §8 makes these optional. Skipped this session.

## Session ID

Sprint 2–4 one-shot, 2026-04-15.
