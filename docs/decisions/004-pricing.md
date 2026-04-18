# ADR-004: Pricing is platform-set per GPU-hour in v1

**Date**: 2026-04-18
**Status**: Accepted
**Authors**: Khalid

## Context

Two pricing models dominate GPU marketplaces:

- **Platform-set** (Salad Cloud, Modal, RunPod): platform publishes a `$/GPU-hour` rate, typically tiered by GPU class. Hosts receive a share of the platform rate. Customers see a single, simple price table.
- **Host-set** (Vast.ai): each host publishes their own rate. Customers compare listings by price, location, bandwidth, reliability. Platform takes a percentage cut on top.

Host-set pricing unlocks supply-side upside — owners can chase higher returns by charging premium for rare hardware, or undercut to win volume. It also creates a transparent two-sided marketplace that the platform is seen as mediating rather than setting. However, it adds complexity:

- **Billing ledger** — per-host accounting instead of a single platform tariff, with per-transaction splits.
- **Customer UX** — customers must compare prices instead of just picking a node, which lengthens the purchase decision.
- **Pitch clarity** — the platform's identity becomes ambiguous ("are we a service or a marketplace?") at a stage where clarity wins.
- **Dispute surface** — host-claimed capability vs. actual capability becomes a chargeback vector.

Current implementation already reflects platform-set pricing implicitly: `users.credits_gpu_hours` is a single-unit balance, and billing happens in `_bill_gpu_hours(started_at, completed_at, gpu_count)` at `control-plane/app/services/job_service.py:32` — no per-node rate.

## Decision

For v1 we use **platform-set pricing**: a published `$/GPU-hour` rate (or rate table keyed by GPU class, if we find customers care about the distinction), with the platform paying hosts a fixed share. Current unit: `credits_gpu_hours` on `users`, rounded up to a 1-hour minimum per job.

We do not add a `hourly_rate` column on `nodes`, a `host_cut_bps` field, or any host-set pricing plumbing without a follow-up ADR.

## Consequences

**Positive**:
- Simpler billing, simpler UX, simpler pitch.
- Matches the hybrid model from ADR-001 — customer picks the node for *non-price* reasons (trust, handle, region), not for bid-shopping.
- Defers the hardest commercial calibration (what is the right rate?) until we have real supply/demand data. Setting the rate wrong once is recoverable; building a pricing marketplace and then ripping it out is not.

**Negative**:
- Leaves money on the table — hosts with premium hardware (A100, H100) cannot charge a premium over hosts with RTX 3060. This caps supply-side incentive to onboard expensive rigs.
- Creates a binary rate-calibration risk: set it too low and we bleed margin paying hosts; set it too high and customers go elsewhere.
- Rounds every job up to ≥1 GPU-hour (see `_bill_gpu_hours`). A 30-second job still bills 1 hour. Acceptable for v1 — worth re-examining when we see real usage distributions.

## Revisit if

- Hosts start leaving the platform because our rate is below their opportunity cost (e.g., Salad earn pays them more, or they'd rather mine).
- A meaningful fraction of potential hosts demand a rate card input before joining.
- Demand concentrates on specific GPU classes (A100, H100) in a way that makes a tiered rate table a natural upgrade path — still platform-set, but tier-aware.
- We see evidence that customers *want* to price-shop (e.g., research groups with fixed monthly budgets), which would justify a marketplace view.

Any of those triggers should open a new ADR superseding this one.
