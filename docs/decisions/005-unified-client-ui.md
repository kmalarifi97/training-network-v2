# ADR-005: Unified client-ui, admin-ui retired from deployment

**Status:** Accepted (supersedes CLAUDE.md rule §11)
**Date:** 2026-04-19

## Context

v1 shipped with two separate Next.js applications:

- `client-ui/` — an Arabic RTL pitch mock with no API calls, optimized for
  incubator screenshots and a choreographed demo.
- `admin-ui/` — an admin dashboard backed by the real API, read-only for
  jobs/nodes plus force-kill/force-drain and user-grant actions.

Rule §11 in CLAUDE.md codified the split: "`client-ui/` is a pitch mock (no
`fetch` calls). `admin-ui/` is the real UI backed by the live API." It also
allowed — via a "deliberate decision" — graduating the mock to real.

## Decision

For the friends-beta MVP, we consolidate to a single UI:

1. **`client-ui/` graduates from pitch mock to the real MVP frontend.**
   All views are wired to the live API: signup/login, marketplace browse, job
   submission, live status + logs polling, job completion summary, my-nodes,
   claim-token creation, and the rendered install block.
2. **`admin-ui/` is retired from deployment.** Removed from
   `docker-compose.yml`. The source tree stays in the repo (frozen, for
   reference) but is no longer built or deployed.
3. **Admin operations move to Swagger at `/docs`.** All admin endpoints
   (`POST /api/admin/users/{id}/approve`, `/suspend`, `/api/admin/jobs/{id}/force-kill`,
   `/api/admin/nodes/{id}/force-drain`, `GET /api/admin/dashboard`, etc.)
   are reachable via Swagger with a JWT from an `is_admin=true` user. At
   7-friend scale, this is sufficient; clicking through Swagger is cheaper
   than maintaining a second frontend.

## Consequences

**Positive:**

- One deployment target (one Next.js app), one fewer docker-compose service,
  one fewer URL to remember.
- No more duplicated styling/layout between two Next.js apps.
- The friends-beta UI is the Arabic RTL polished app — matches the product
  audience (Saudi Arabic users), not an admin console.
- Admin endpoints remain accessible (via Swagger) without a custom UI layer
  that would need maintenance.

**Negative:**

- Admin ops are clunkier without a UI — each approve/suspend/force-kill
  requires a Swagger click-through. Acceptable because it fires under 20
  times total during friends-beta (per the "don't over-engineer for scale"
  judgment). Revisit when stranger-signups outpace admin patience.
- We lose the safety boundary of "admin endpoints live in a separate UI" —
  if we later add admin views inside `client-ui`, they must be gated by an
  `is_admin=true` check from `GET /api/me` before any admin-only component
  renders or fetches. Server-side authorization on each endpoint is the
  load-bearing defense; the UI gate is defense-in-depth.
- The pitch mock is lost (commit `75dc8b9` and earlier on `main` still has
  it if needed). Acceptable because incubator screenshots were already
  captured; the demo's job is done.

## Rule §11 supersession

CLAUDE.md rule §11 is updated to reflect the new state:

> **`client-ui/` is the single deployed UI**, backed by the live API.
> `admin-ui/` remains in the repo but is not built or deployed (see
> ADR-005). Admin operations during friends-beta go through Swagger at
> `/docs`. If admin operations later need a richer UI, add role-gated
> routes inside `client-ui` (check `user.is_admin` from `/api/me`) —
> do not resurrect a separate admin app.

## When to revisit

Consider splitting UIs back apart when:

- Admin-only functionality grows past ~5 distinct screens (dashboard,
  user management, job ops, node ops, audit log, billing) — at that
  volume, mixing into `client-ui` creates UI bloat and real security
  risk from accidental exposure.
- You hire a second frontend developer — separation-of-concerns becomes
  an organizational signal, not just a code one.
- A specific admin action requires heavy, admin-only components (e.g.,
  a billing dashboard with chart libraries) that you don't want to
  bundle into the user-facing JS payload.

Until then, one UI.
