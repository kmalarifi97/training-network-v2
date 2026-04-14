# GPU Network v1 — Onboarding for the next coding session

This file exists for the next engineer (or Claude session) picking up Sprint 1. Read it top-to-bottom before touching the code.

---

## 1. What you are doing in this session

**Your one job:** implement the 4 pending Sprint 1 stories — **O6, O5, R2, H2** — against the Story Contracts already approved on Miro.

- Do **not** write new Story Contracts. The contracts exist, they are approved, just follow them.
- Do **not** change scope. If a contract seems wrong, stop and ask the PM.
- Do **not** skip tests. Every story must ship with integration tests.

---

## 2. Expected session output (Definition of Done)

When this session ends, the repo must be in this state:

### 2.1 Git history

On `main`, in addition to the 3 existing commits, these new commits must exist:

```
docs: add README + ONBOARDING for Sprint 1 handoff   (or similar — commit the handoff docs early)
O6: implement admin grant access
O5: implement admin audit log view
R2: implement user API keys
H2: implement claim token + node registration  (control plane and node agent)
```

One commit per story, one docs commit, ordered as above. No force-push, no amending shipped commits.

### 2.2 Feature completion

Each of the following must be true, verified by tests:

| Story | What passes |
|---|---|
| O6 | Admin (`is_admin=true`) can list users, filter by status, approve (sets status=active, can_host, credits), suspend. Non-admin gets 403. Audit events emitted. |
| O5 | Admin can list audit events with filters (event_type, user email, IP, date range) and paginate. Admin can fetch a single event's full details. Non-admin gets 403. |
| R2 | Active user can generate, list, and revoke API keys. The plaintext key is shown exactly once. Revoked keys can't authenticate. Pending/suspended users get 403 on generate. API key works as Bearer token interchangeably with JWT. |
| H2 | Host with `can_host=true` can generate a one-time claim token (valid 24h). Agent on the host machine detects GPUs via nvidia-smi, POSTs to `/api/nodes/register` with token + specs, token is consumed, node appears in the user's list. Non-host gets 403. |

### 2.3 Technical state

- `docker compose up --build` boots to green `/health` in under 15 seconds from cold
- `docker compose exec -T control-plane pytest -v` passes: R1 tests (10) **plus** new tests for O6, O5, R2, H2
- `cd node-agent && go build ./...` passes and produces a working `gpu-agent` binary
- Alembic migrations apply cleanly on a fresh DB (3 new migrations beyond the R1 one)
- No regressions in R1 tests
- No lint errors (run `ruff check .` inside the container if available)

### 2.4 Contracts unchanged on Miro

The Sprint 1 Story Contracts on Miro must be byte-identical at the end of the session vs. the start. If you discover the contract was wrong mid-implementation, **stop, update the contract on Miro, get PM approval, then resume code**. Do not silently diverge.

### 2.5 Memory updates (if warranted)

If any new gotcha surfaced (like the bcrypt/NullPool bugs in R1), save a new `feedback_<topic>.md` in memory and update `MEMORY.md`. Otherwise leave memory alone.

### 2.6 What NOT to deliver

- A GitHub remote — not this session
- Should-have stories (R3, R8, R9, H4, H5, O4) — Sprint 1 is Must-only
- A frontend / UI — backend APIs only, Swagger UI at `/docs` is enough for demo
- Sprint 2 contracts on Miro — not this session

---

## 3. Quick start

```bash
cd /Users/khalid-dev/gpu-network-v2
docker compose up --build
```

- Control plane: http://localhost:8000
- Swagger UI: http://localhost:8000/docs
- Health: http://localhost:8000/health

Run the test suite inside the container:

```bash
docker compose exec -T control-plane pytest -v
```

**Never run Python locally.** No venv, no `python3 -c`, not even for syntax checks. Docker is a hard project rule — the user has corrected this before.

---

## 4. Repo layout

```
gpu-network-v2/
├── README.md                 # project intro + session handoff summary
├── ONBOARDING.md             # this file
├── docker-compose.yml        # control-plane + postgres
├── control-plane/            # FastAPI service
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pyproject.toml        # pytest + ruff config
│   ├── alembic.ini
│   ├── alembic/              # async migrations
│   │   └── versions/
│   │       └── 20260412_1930_0001_initial.py   # users + audit_log
│   └── app/
│       ├── main.py           # FastAPI app, mounts controllers, exception handlers
│       ├── config.py         # pydantic-settings
│       ├── db.py             # async engine (NullPool — do not remove) + session factory
│       ├── deps.py           # DbSession, CurrentUser, AuthServiceDep, HTTPBearer scheme
│       ├── controllers/      # HTTP route handlers (thin)
│       ├── services/         # Business logic (thick, owns audit emission)
│       ├── repositories/     # DB queries only, no business rules
│       ├── models/           # SQLAlchemy ORM entities
│       ├── schemas/          # Pydantic request/response DTOs
│       └── core/             # security (bcrypt + JWT), errors
│   └── tests/                # pytest-asyncio integration suite
├── node-agent/               # Go worker agent
│   ├── go.mod
│   ├── main.go               # main → cmd.Run
│   ├── cmd/                  # CLI: init, start, status, version (stubs)
│   └── internal/             # agent, config, gpu (stubs — implement in H2)
└── deprecated/               # previous attempt, in .gitignore, leave alone
```

---

## 5. The Story Contract system

### Miro board

https://miro.com/app/board/uXjVGkF381g=/

Layout:
- Top row: stories table · architecture diagram · dep graph
- Left side: Story Contract template (the rule)
- Stacked rows (y increases downward): R1 → O6 → O5 → R2 → H2. Each row is one story's contract.

### The 4-item rule

Every story needs all 4 of these on Miro, written at **business level** (user actions + outcomes, no HTTP/DB/service names):

1. **Story** — who/what/why (row in the stories table)
2. **Acceptance Criteria** — verifiable bullets (in the Story doc)
3. **Flowchart** — user journey with decision points
4. **Sequence Diagram** — actors are User / Admin / Host / GPU Network App

The API endpoints and DB schema you implement must be consistent with the contract, but they are your design, derived from it.

---

## 6. Implementation pattern (control plane)

```
HTTP request
    │
    ▼
controllers/<topic>.py         # parse request, call service, shape response
    │
    ▼
services/<topic>_service.py    # business logic, orchestration, emit audit events
    │
    ▼
repositories/<topic>_repo.py   # SQLAlchemy queries
    │
    ▼
models/<topic>.py              # ORM entities

schemas/<topic>.py     # Pydantic DTOs for controllers
core/security.py       # bcrypt + JWT + (in R2) API key hashing
core/errors.py         # domain exceptions, mapped to HTTP in main.py
deps.py                # DbSession, CurrentUser, AdminUser (new in O6), AuthServiceDep
```

### R1 as a worked example (already shipped)

Read these files before writing O6/O5/R2/H2:

- `app/schemas/auth.py` — Pydantic DTOs
- `app/models/user.py`, `models/audit_log.py` — ORM
- `app/repositories/user_repo.py`, `audit_repo.py`
- `app/services/auth_service.py`
- `app/controllers/auth.py`, `controllers/users.py`
- `app/core/security.py` — bcrypt + JWT
- `app/core/errors.py`
- `app/deps.py`
- `tests/controllers/test_auth.py`
- `alembic/versions/20260412_1930_0001_initial.py`

Follow the same layering and style for the new stories.

---

## 7. Sprint 1 coding plan (detail per story)

Code in this order (smallest first, ending with the cross-repo H2).

### Story 1: O6 — Admin grants access

**Miro:** https://miro.com/app/board/uXjVGkF381g=/?moveToWidget=3458764667754416257

**Alembic migration:**
- Add `users.is_admin BOOLEAN NOT NULL DEFAULT false`
- Add `users.credits_gpu_hours INTEGER NOT NULL DEFAULT 0`

**How to seed first admin:** add a tiny CLI command (`python -m app.cli grant-admin <email>`) or a one-shot SQL migration that promotes a known email. Document whichever you pick in a `scripts/` folder.

**New dep:** `AdminUser = Annotated[User, Depends(require_admin)]` that checks `is_admin` and returns 403 otherwise.

**Endpoints (under `/api/admin/`, admin-only):**
- `GET  /users?status=&email=&cursor=&limit=50` — list/search
- `GET  /users/{id}` — single user detail
- `POST /users/{id}/approve` body `{can_host: bool, credits_gpu_hours: int}` — status → active, set flags
- `POST /users/{id}/suspend` — status → suspended

**Audit:** emit `user.approved`, `user.suspended` events including the admin who did it (`actor_user_id` in event_data) and the flags set.

**Tests:** admin guard (non-admin → 403), happy approve, happy suspend, approve already-active user, approve non-existent user.

---

### Story 2: O5 — Admin views audit logs

**Miro:** https://miro.com/app/board/uXjVGkF381g=/?moveToWidget=3458764667755700973

**No new tables** — reuse `audit_log` from R1.

**Endpoints (admin-only):**
- `GET /api/admin/audit?event_type=&user_email=&ip=&from=&to=&cursor=&limit=50`
  - Cursor-based pagination (opaque cursor on `(created_at, id)`)
  - Default: most recent 50
- `GET /api/admin/audit/{id}` — full event with user_agent + event_data JSON

**Audit meta:** each call to the audit-list endpoint itself emits an `audit.viewed` event — admins watching each other.

**Retention:** decide with PM before coding. Proposed default: **180 days**. If agreed, add a weekly cleanup task (can be a simple SQL script in `scripts/` for now — real scheduler later).

**Tests:** filter combinations, pagination works, admin guard, self-audit of viewing.

---

### Story 3: R2 — User API keys

**Miro:** https://miro.com/app/board/uXjVGkF381g=/?moveToWidget=3458764667758117089

**Alembic migration:** new table `api_keys`:

```
id            UUID PK
user_id       UUID FK users.id (ON DELETE CASCADE)
name          VARCHAR(100) NOT NULL
prefix        VARCHAR(12)  NOT NULL UNIQUE   -- first 12 chars of the key, for lookup and display
hash          VARCHAR(255) NOT NULL          -- bcrypt hash of the full key
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
revoked_at    TIMESTAMPTZ NULL
```

Indexes: `user_id`, `prefix`.

**Key format:** `gpuk_` + 32 random URL-safe chars. Prefix = first 12 chars (`gpuk_XXXXXX…`).

**Endpoints (authenticated users, but require `status=active` — pending/suspended users get 403):**
- `POST   /api/keys` body `{name}` → `{id, name, full_key}` (full_key returned *once*; afterwards only prefix)
- `GET    /api/keys` → `[{id, name, prefix, created_at, revoked_at}]` (user's own keys)
- `DELETE /api/keys/{id}` → sets `revoked_at = now()`

**Auth update in `deps.py`:** `get_current_user` accepts a token that can be either:
- A JWT (existing behavior)
- An API key: starts with `gpuk_`; look up by prefix, bcrypt-verify the hash, check `revoked_at IS NULL`, load the user

**Audit:** emit `apikey.created` (include prefix + name), `apikey.revoked`.

**Tests:** full flow (create → copy → list shows prefix only → revoke → auth with revoked key returns 401), pending user cannot create, API key can be used on any authed endpoint (e.g. `/api/me`).

---

### Story 4: H2 — Host registers node with claim token

**Miro:** https://miro.com/app/board/uXjVGkF381g=/?moveToWidget=3458764667759701799

This one spans both `control-plane/` and `node-agent/`.

**Control plane — Alembic migration:**

```
claim_tokens
  id           UUID PK
  user_id      UUID FK users.id
  token_hash   VARCHAR(255) NOT NULL        -- bcrypt hash of the plaintext token
  prefix       VARCHAR(12)  NOT NULL UNIQUE -- for lookup
  expires_at   TIMESTAMPTZ NOT NULL
  consumed_at  TIMESTAMPTZ NULL
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()

nodes
  id              UUID PK
  user_id         UUID FK users.id
  name            VARCHAR(100) NOT NULL
  gpu_model       VARCHAR(100) NOT NULL
  gpu_memory_gb   INTEGER      NOT NULL
  gpu_count       INTEGER      NOT NULL
  status          VARCHAR(20)  NOT NULL DEFAULT 'offline'   -- online | offline | draining
  last_seen_at    TIMESTAMPTZ  NULL
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
```

**Endpoints:**
- `POST /api/nodes/claim-tokens` (host user, `can_host=true`) → `{token, install_command, expires_at}`
  - Token format `gpuclaim_` + 32 URL-safe chars; prefix = first 12 chars
  - TTL: 24 hours
- `POST /api/nodes/register` **(unauthenticated; auth is the claim token in body)** body `{claim_token, gpu_model, gpu_memory_gb, gpu_count, suggested_name?}` → `{node_id, config_payload}`
  - Look up claim by prefix, verify hash, check `expires_at > now()`, check `consumed_at IS NULL`
  - Create the node, set `consumed_at`
- `GET /api/nodes` (current user) → their nodes

**Audit:** emit `node.registered` (node_id, gpu_model, gpu_count, host user).

**Node agent (Go):**
- `cmd/init.go`: prompt for control-plane URL + claim token, call `internal/gpu/detect.go`, POST to `/api/nodes/register`, write `/etc/gpu-agent/config.yaml` (or `~/.gpu-agent/config.yaml` in dev mode)
- `internal/gpu/detect.go`: shell out to `nvidia-smi --query-gpu=name,memory.total,count --format=csv,noheader,nounits`, parse output. If the command is missing, return a typed error. Make this testable by accepting an injected command runner.
- `internal/config/config.go`: struct `Config { ControlPlaneURL, NodeID, AgentToken, ConfigPath }` with `Load()` and `Save()` using `gopkg.in/yaml.v3`
- `internal/agent/daemon.go`: leave as `TODO` for H3/H6 — H2 only needs registration, not the poll loop

**Tests:**
- Control plane: claim token lifecycle (create → valid → consumed; expired), non-host user gets 403 on token creation, invalid token rejected on register
- Agent: `gpu detect` parses example nvidia-smi output into `[]Device`; error path when command missing (use a mock runner)

**Installer:** for v1, a manual README block is fine — no hosted installer script yet. The install command the app shows the user can just be the path to a script they run by hand.

---

## 8. Coding conventions

- `async`/`await` everywhere in control plane
- UUIDs client-side via `uuid4()`
- All timestamps UTC via `datetime.now(timezone.utc)`
- Commit messages: `<story-id>: <sentence>` plus the `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` trailer
- Only add a comment when the *why* is non-obvious. Don't narrate what the code does.
- No emojis in code or tests unless user asks
- Prefer specific imports over `from x import *`
- All new models must have a `server_default=func.now()` on `created_at`
- Pydantic DTOs with `from_attributes=True` when mapping from ORM

---

## 9. Known gotchas (do not repeat)

1. **passlib 1.7.4 is broken with bcrypt 4.1+.** Use `bcrypt` directly, as in `app/core/security.py`.
2. **SQLAlchemy async pool fights pytest-asyncio's event loops.** `NullPool` in `app/db.py` is the fix. Do not change this without a plan.
3. **bcrypt errors on passwords longer than 72 bytes.** Pydantic schema caps at 72 chars.
4. **Claim tokens, API keys, and any secret input must be >72 bytes safe.** Consider hashing longer secrets with SHA-256 first if length could ever exceed 72 bytes.
5. **Nested `.git` in `deprecated/`.** It's in the root `.gitignore`. Do not try to operate on it. Do not read code from it — "start from scratch" was a PM decision.
6. **Docker-only for Python.** Syntax checks, test runs, pip installs, all in Docker. The user has rejected local Python twice.

---

## 10. Session workflow

1. Read this file top to bottom
2. Read `README.md`
3. Check memory: `cat ~/.claude/projects/-Users-khalid-dev-gpu-network-v2/memory/MEMORY.md`
4. Boot: `docker compose up --build` — confirm green
5. Test: `docker compose exec -T control-plane pytest -v` — should be 10 passing
6. Commit the handoff docs first: `git add README.md ONBOARDING.md && git commit -m "docs: ..."`
7. Implement O6 → commit → O5 → commit → R2 → commit → H2 → commit
8. Re-run full test suite after each commit
9. At the end, write a session summary to the user with new commit hashes + any memory updates

If anything blocks you for more than a few minutes — ambiguous contract, unexpected error, scope question — **stop and ask the PM**. Do not invent scope.
