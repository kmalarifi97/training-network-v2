# GPU Network v1

Community GPU network inspired by Salad Cloud and Vast.ai. Saudi-Arabia-based v1 targets 5–7 users and 2 GPU nodes as a trusted-friends launch, with architecture designed so it can later open to untrusted public contributors without a rewrite.

## Status

- **Sprint 0 shipped:** user signup, login, /me, audit log
- **Sprint 1 contracts approved on Miro** (5 stories, all business-level)
- **Sprint 1 code not yet written** — handoff is ready for the next session

## Quick start

```bash
docker compose up --build
# Control plane:  http://localhost:8000
# Swagger UI:     http://localhost:8000/docs
# Run tests:      docker compose exec -T control-plane pytest -v
```

**Docker only.** No local Python venv, not even for syntax checks — project rule.

## Repo layout

```
control-plane/      Python + FastAPI + Postgres (layered: controllers → services → repos → models)
node-agent/         Go single-binary worker daemon (stub — implemented in Sprint 1)
docker-compose.yml  Local dev stack
ONBOARDING.md       Detailed guide for the next engineer / session
```

## Where design lives

- **Miro board:** https://miro.com/app/board/uXjVGkF381g=/
- **User stories table** on Miro — 22 stories (Renter R1–R9, Host H1–H7, Operator O1–O6)
- **Build-order dependency graph** — Sprint 0 → 4 mapping
- **v1 System Architecture** — 3 clusters (end users, control plane, host machine)
- **Story Contract template** — the 4-item Definition of Ready rule
- **Per-story contracts** — stacked vertically, one row per story

## The Story Contract rule

Before any code is written, a story must have **all 4 artifacts** on Miro:

1. **Story** — who/what/why (row in the stories table)
2. **Acceptance Criteria** — verifiable *done looks like* bullets
3. **Flowchart (business-level)** — user journey + decisions, in user-visible language
4. **Sequence Diagram (business-level)** — actors are User / Admin / Host / GPU Network App — never internal services or DB operations

## Session output (handoff)

### Shipped this session

**Miro — full product plan and all Sprint 1 contracts**
- 22-story user stories table
- Build-order dependency graph (top-to-bottom, sprint clusters)
- v1 system architecture diagram
- Story Contract template (4-item business-level rule)
- Contracts for R1 (retrospective gold-standard), O6, O5, R2, H2

**Code — R1 end-to-end**
- Layered control-plane scaffold (Python 3.12 + FastAPI + async SQLAlchemy + Alembic + pytest)
- Node-agent Go skeleton (`cmd/` subcommands, `internal/` packages stubbed)
- R1 implemented: signup, login, /me, audit log on every auth event
- Alembic migration for `users` + `audit_log`
- 10 integration tests passing
- `docker compose up --build` boots green in under 10 seconds

**Git — 3 commits on `main` (local only, no remote yet)**
```
10ab939  fix R1: drop passlib for direct bcrypt + use NullPool for async sessions
3ecea38  implement R1: signup, login, /me + audit log + alembic
ca1f10a  initial scaffold: control-plane (FastAPI) and node-agent (Go)
```

**Docs — added at repo root**
- `README.md` (this file)
- `ONBOARDING.md` — detailed pickup guide for the next coding session

**Memory — persistent across sessions, in `~/.claude/projects/.../memory/`**
- `feedback_use_docker.md` (strengthened: Docker for *any* Python execution)
- `feedback_business_level_diagrams.md` (new: Miro diagrams never show HTTP/DB/services)
- `MEMORY.md` index refreshed

### Architectural decisions locked in

- **Path B — Salad-style pull-based worker agents.** Workers always initiate HTTPS out to control plane. No inbound ports on the host. Plain Docker on the worker, *not* k8s.
- **Model 1 — one account, multi-role.** A user is renter, host, or both; `can_rent` and `can_host` flags on the user row.
- **Invite-only launch.** New users land with `status='pending'`; admin manually grants access via story O6 before they can submit jobs or host.
- **Contract-first workflow.** 4 Miro artifacts before any code for a story.
- **Stack:** Python 3.12 + FastAPI + Postgres for control plane · Go 1.22 for node agent · bcrypt directly (not passlib) · JWT + API keys · Alembic async migrations · pytest-asyncio · NullPool on the async engine.

### Pending — for the next session

1. Commit `README.md` and `ONBOARDING.md` (currently untracked)
2. Implement the 4 Sprint 1 stories per their Miro contracts, in order:
   - **O6** — Admin grants access
   - **O5** — Admin views audit logs
   - **R2** — User generates/revokes API keys
   - **H2** — Host installs agent and registers node with claim token
3. One commit per story, referencing the story ID
4. After Sprint 1 ships: build Sprint 2 contracts on Miro (R4, H3, O2) → then code

### What NOT to do in the next session

- Do not skip the Miro contracts — read them before coding each story
- Do not write backend-speak in Miro diagrams (no POST / DB / service names)
- Do not run `python3` on the host machine — Docker only
- Do not touch the `deprecated/` directory

---

## Session ID

`f68be31e-7200-4349-93ac-23457aabea16`

Session date: 2026-04-14. Transcript lives in `~/.claude/projects/-Users-khalid-dev-gpu-network-v2/f68be31e-7200-4349-93ac-23457aabea16.jsonl`.
