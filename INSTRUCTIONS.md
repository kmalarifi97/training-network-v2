# v1 Completion — Instructions for the next session

One session, one big push. Ship all 10 remaining v1 Must stories across Sprints 2, 3, and 4. **No contracts-before-code this time — write the code, write the tests, commit. Diagrams on Miro come *after*, as retrospective visualization, not as a gate.**

---

## 1. What you are doing

Implement **all 10 remaining Must stories** in one session, one commit per story. At the end, v1's Must scope is complete: users can submit jobs, workers can run them, admins can see what's going on.

Stories to ship:

| Sprint | Story | One-liner |
|---|---|---|
| 2 | **R4** | User submits a job (Docker image + cmd + GPU count) |
| 2 | **H3** | Host sees node status + agent heartbeats |
| 2 | **O2** | Platform GPU telemetry via Prometheus |
| 3 | **R5** | User sees job status |
| 3 | **R6** | User streams job logs |
| 3 | **R7** | User cancels a job |
| 3 | **H6** | Host drains a node |
| 3 | **H7** | Host disconnects a node cleanly |
| 4 | **O1** | Admin ops dashboard |
| 4 | **O3** | Admin force-kill / force-drain |

If context gets tight mid-session, **commit what you have, note what's left in a final message, and hand back — the user will open a new session from that point.**

---

## 2. Definition of Done (whole session)

1. All 10 stories implemented, each in its own commit (`<story-id>: <sentence>` subject line with the `Co-Authored-By` trailer).
2. `docker compose up --build` boots to green `/health` under 15 seconds from cold.
3. `docker compose exec -T control-plane pytest -v` passes — R1 tests (10) + Sprint 1 tests + every new Sprint 2–4 test. No skips.
4. `cd node-agent && go build ./...` passes; `go test ./...` passes.
5. Alembic has 4 new migrations (one per story that needs a schema change — not every story does).
6. No regressions on any existing endpoint.
7. `README.md` updated at end with the final commit list and session ID.
8. Memory updated if new gotchas surfaced (new `feedback_<topic>.md` + index entry).

If you cannot meet the DoD (e.g. time-boxed session), ship as many fully-green commits as you can and stop — **do not** commit half-implemented features.

---

## 3. Before you write code

1. Read this file top-to-bottom.
2. Read `README.md` — project intro + last session's output + architectural decisions.
3. Read `ONBOARDING.md` — it's stale on *what to do next* (Sprint 1 is done) but gold on **how the code is laid out, coding conventions, the 6 known gotchas, and R1/Sprint 1 file paths to study as worked examples.**
4. Read memory: `cat ~/.claude/projects/-Users-khalid-dev-gpu-network-v2/memory/MEMORY.md`
5. Boot the stack: `docker compose up --build`. Confirm green `/health` and that the existing pytest suite passes. If it's already broken, fix before adding.

---

## 4. Story specs

Design decisions (schema columns, pagination, secondary endpoints) are your call — use R1 and Sprint 1 as the pattern. The specs below are the contract shape; anything unmentioned is your judgement.

### R4 — User submits a job
- New `jobs` table: `id (UUID PK), user_id FK users, docker_image VARCHAR(255), command JSONB (list of strings), gpu_count INT, max_duration_seconds INT, status VARCHAR(20) (queued|running|completed|failed|cancelled), exit_code INT NULL, error_message TEXT NULL, assigned_node_id FK nodes NULL, created_at, started_at NULL, completed_at NULL`
- `POST /api/jobs` — active user. Body `{docker_image, command: string[], gpu_count, max_duration_seconds}`. Returns the new job with `status="queued"`.
- Validate: `users.credits_gpu_hours >= gpu_count * max_duration_seconds / 3600` at submit time (reserve-style check), gpu_count ≥ 1, command non-empty, image string non-empty and fits basic `registry[:tag]` format.
- Audit: `job.submitted`.
- Tests: happy path, pending user → 403, no credits → 402, invalid image → 422, gpu_count=0 → 422.

### H3 — Host sees node status + heartbeat
- Add `nodes.agent_token_hash` (bcrypt-hashed at registration — update H2's `register` handler to return the plaintext agent token once, store the hash). Call it `gpuagent_…`, 12-char lookup prefix same pattern as API keys.
- `GET /api/nodes/{id}` (owner) — returns: status, last_seen_at, current_job_id (from jobs table).
- **Agent auth:** add `get_current_node` dep that resolves the Bearer agent token to a `Node`. Separate from `get_current_user`.
- `POST /api/nodes/{id}/heartbeat` (agent auth) — updates `last_seen_at = now()`. Body may include current job progress or be empty.
- `online` / `offline` is computed from `last_seen_at` vs. now (threshold: 60s). No cron job — compute on read.
- Tests: owner reads, other user 404, heartbeat updates, stale node reads as offline.

### O2 — Platform GPU telemetry
- `pip install prometheus-client`. Mount a `/metrics` ASGI app.
- Control-plane metrics: `http_requests_total` (method, path, status), `http_request_duration_seconds` (histogram), `jobs_in_status{status=…}` (gauge), `nodes_in_status{status=…}` (gauge).
- Agent pushes node telemetry: `POST /api/nodes/{id}/metrics` body `[{gpu_index, utilization_pct, memory_used_bytes, memory_total_bytes, temperature_c}, …]` (agent auth). Stored in a small `node_metrics` table with `ON CONFLICT (node_id, gpu_index) DO UPDATE` — latest sample only for v1. Re-exposed via Prometheus gauges with labels `node_id` and `gpu_index`.
- Tests: `/metrics` returns well-formed text exposition; agent push updates stored metrics and is reflected at `/metrics`.

### R5 — User sees job status
- `GET /api/jobs?status=&cursor=&limit=50` (current user's jobs only) — cursor pagination like `/api/admin/audit`.
- `GET /api/jobs/{id}` — full detail, owner-only.
- State machine enforcement: reject transitions other than `queued → running`, `running → (completed|failed|cancelled)`, `queued → cancelled` (by user). No other transitions allowed anywhere in the code.
- Tests: own jobs only, status transitions observable, other users' jobs → 404.

### R6 — User streams job logs
- New `job_logs` table: `id, job_id FK jobs, stream VARCHAR(6) (stdout|stderr), content TEXT, sequence INT, received_at TIMESTAMPTZ`. Unique `(job_id, sequence)`. Index on `(job_id, sequence)`.
- `POST /api/jobs/{id}/logs` (agent auth, agent must be the assigned node) body `[{stream, content, sequence}, …]` — batched.
- `GET /api/jobs/{id}/logs?after_sequence=N&limit=500` (owner) — returns ordered log lines.
- SSE / websocket live streaming is **not required** for v1; polling is enough.
- Tests: agent pushes, user reads in order, sequence dedupe, non-owner reads → 404.

### R7 — User cancels a job
- `POST /api/jobs/{id}/cancel` (owner) — sets status to `cancelled` if currently `queued`. If `running`, marks a `cancel_requested_at` column (add it) and relies on the agent's next heartbeat to return `{cancel: true}` in its response, at which point the agent kills the container and POSTs `/complete` with `exit_code=-1, error_message="cancelled by user"`.
- `POST /api/nodes/{id}/heartbeat` response includes `cancel_job_id` when the node's current job has been cancel-requested.
- Audit: `job.cancelled`.
- Tests: cancel queued → immediate, cancel running → flagged, heartbeat returns cancel signal, completed jobs cannot be cancelled.

### H6 — Host drains a node
- `POST /api/nodes/{id}/drain` (owner). Sets `nodes.status = 'draining'`. Scheduler (the `/api/jobs/claim` endpoint from the scheduler section below) must not assign new jobs to draining nodes.
- `POST /api/nodes/{id}/undrain` (owner). Only allowed when `status='draining'`; returns to `online`.
- Tests: draining rejects new assignments, undrain resumes, only owner can drain.

### H7 — Host disconnects a node cleanly
- `DELETE /api/nodes/{id}` (owner). If the node has a running job → **409 Conflict** with message to drain first. Otherwise: delete the node row, revoke agent_token (null the hash so the token stops authenticating), emit audit `node.removed`.
- Tests: deleting with running job → 409, deleting idle/drained node works, agent token after delete is rejected.

### O1 — Admin ops dashboard
- `GET /api/admin/dashboard` (admin only). Returns JSON:
  ```
  {
    "users":   {"total":N, "pending":N, "active":N, "suspended":N},
    "nodes":   {"online":N, "offline":N, "draining":N},
    "jobs":    {"queued":N, "running":N, "completed_24h":N, "failed_24h":N, "cancelled_24h":N},
    "compute": {"gpu_hours_served_24h":N}
  }
  ```
- Tests: admin-only; counts match what tests seeded.

### O3 — Admin force-kill / force-drain
- `POST /api/admin/jobs/{id}/force-kill` — admin can cancel any user's job. Audit `admin.job.force_killed` with `actor_user_id=<admin_id>`.
- `POST /api/admin/nodes/{id}/force-drain` — admin can drain any host's node. Audit `admin.node.force_drained`.
- Tests: admin succeeds, regular user → 403.

---

## 5. Scheduler / job-claim endpoint (load-bearing)

R4 + H3 + R5 together only mean something if jobs actually run on nodes. Build the scheduler as part of Sprint 2:

- `POST /api/jobs/claim` (agent auth, node claiming work)
  - Select the oldest queued job where `gpu_count ≤ claiming_node.gpu_count` AND there is no running job already assigned to this node AND `claiming_node.status = 'online'`
  - Use `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction to avoid two nodes claiming the same job
  - On match: set `jobs.status='running'`, `assigned_node_id`, `started_at=now()`, return `{job_id, docker_image, command, max_duration_seconds}`
  - On no match: return 204 No Content
- `POST /api/jobs/{id}/complete` (agent auth, the assigned node) body `{exit_code, error_message?}` — sets status=`completed` if exit_code==0, else `failed`; sets `completed_at`. Deducts actual GPU-hours from `users.credits_gpu_hours`. Emit audit `job.completed` or `job.failed`.
- Node agent **daemon loop** (`internal/agent/daemon.go` is currently a stub — time to implement):
  - Tick every 10s: heartbeat, then if idle, try to claim a job
  - If claimed: `docker run --gpus all --rm -i <image> <cmd…>`, stream stdout/stderr back via `/logs`, on exit POST `/complete`
  - Respect `cancel_job_id` from heartbeat response — kill the container and POST `/complete` with `exit_code=-1`
  - `cmd/start.go` currently prints TODO — wire it to the daemon loop

---

## 6. What you are NOT doing

- **No GitHub remote** — stay local.
- **No Should-have stories** (R3, R8, R9, H4, H5, O4). If any story you implement naturally covers part of a Should, that's fine; don't add endpoints just for a Should.
- **No frontend / UI** — backend APIs only. Swagger at `/docs` is the visible surface.
- **No Miro contracts in advance.** Diagrams are post-code, retrospective. See section 8.
- **No scheduler improvements beyond FIFO + SKIP LOCKED** — no bidding, no priority, no spot-pricing. Keep scope tight.

---

## 7. Conventions (reminder)

- `async`/`await` throughout the control plane.
- UUIDs client-side (`uuid4()`). Timestamps UTC (`datetime.now(timezone.utc)`).
- `NullPool` in `app/db.py` — do not change.
- Use `bcrypt` directly — never `passlib`.
- One commit per story. Run the full test suite between commits.
- No comments that narrate what the code does; only comments that explain the non-obvious why.
- Docker for every Python execution — syntax checks, tests, everything.

---

## 8. After all 10 are shipped: retrospective diagrams on Miro

Only after every story is green and committed:

1. Open the Miro board: https://miro.com/app/board/uXjVGkF381g=/
2. For each of the 10 new stories, add a row at increasing y-values with **two diagrams only** (no Story+AC doc — that lives in this file and the acceptance tests):
   - **Flowchart** — user journey + decision points, business-level
   - **Sequence diagram** — business-level actors (User / Host / Admin / GPU Network App / Host Machine)
3. These are documentation-of-what-was-built, not approval gates.
4. Keep business-level: no POSTs, no DB names, no service names. See `feedback_business_level_diagrams.md` in memory for the rule.

If there is no time for the diagrams, skip them — they're reference, not required for the DoD.

---

## 9. Known gotchas (do not repeat)

1. **passlib 1.7.4 is broken with bcrypt 4.1+.** Use `bcrypt` directly.
2. **SQLAlchemy async pool fights pytest-asyncio.** `NullPool` in `app/db.py` — keep it.
3. **bcrypt rejects passwords > 72 bytes.** Pydantic caps at 72 chars.
4. **Long secrets (API keys, claim tokens, agent tokens) must stay ≤ 72 bytes** — use `secrets.token_urlsafe(24)` (~32 chars) as in existing code.
5. **Docker-only for Python** — don't run `python3` on the host.
6. **`deprecated/` has been moved out of the repo** to `/Users/khalid-dev/gpu-network-v1-archive/`. Do not look for it inside the repo; do not copy code from it.
7. **HTTP status code for insufficient credits: 402 Payment Required.** It's the standardized one; use it.
8. **Agent auth ≠ user auth.** Agents authenticate with the node's `agent_token`, not a JWT or API key. Keep the two code paths distinct in `deps.py`.

---

## 10. Session workflow

1. Read this file + `README.md` + `ONBOARDING.md` + memory
2. `docker compose up --build` → green; `pytest -v` → all pass
3. **Sprint 2:** R4 → commit. H3 → commit. O2 → commit. Scheduler endpoint + daemon loop bundled into Sprint 2's commits where they fit naturally.
4. **Sprint 3:** R5, R6, R7, H6, H7 — one commit each.
5. **Sprint 4:** O1, O3 — one commit each.
6. Run full test suite after every commit. If it goes red, stop and fix before moving on.
7. At the end, update `README.md` (final commits, new session ID, status "v1 Musts shipped") and commit: `docs: update README after Sprint 2-4`.
8. Report back with: new commit hashes, tests-total count before/after, any memory updates, any work skipped and why.

If anything blocks you that isn't solvable by reading the code or the existing contracts (e.g. an ambiguity that shapes the schema), **stop and ask**. Don't guess architecture.
