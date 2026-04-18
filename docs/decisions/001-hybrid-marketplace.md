# ADR-001: Hybrid marketplace model (customer-picks-node, container-only execution)

**Date**: 2026-04-18
**Status**: Accepted
**Authors**: Khalid

## Context

Building a GPU network layer for Saudi Arabia. Two incumbent reference models dominate the space:

- **Salad Cloud**: customer submits a container, platform assigns it to an opaque fleet. No node selection. Model works because nodes are ephemeral consumer PCs — any single node is fungible and replaceable.
- **Vast.ai**: customer browses listings (GPU model, price, bandwidth, reliability score), picks a specific rig, gets SSH + persistent storage. Hosts set their own prices.

Neither fits our context cleanly:

- Supply at launch is 2–5 nodes. An "opaque fleet" feels empty when the fleet is that small.
- Hosts are community members (trusted friends at launch, untrusted public later). SSH into their home PCs is a security minefield and a legal liability we do not want to own.
- Our go-to-market pitch leans on *community-owned local compute in Saudi Arabia* as a differentiator. Anonymizing hosts into capacity buries the story.

The orthogonal axes are not "Salad vs Vast." They are three independent dimensions:
- **Who chooses the node** — customer or platform
- **Access mode** — container-only or SSH/persistent
- **Pricing** — host-set or platform-set

Salad = (platform, container, platform). Vast = (customer, SSH, host). Everything in between is legitimate.

## Decision

We adopt a **hybrid**: marketplace UX with sealed execution.

- **Node selection**: **customer picks** (Vast-like). Jobs carry `preferred_node_id`; scheduler queues the job against that node and does not auto-reassign.
- **Execution**: **container-only** (Salad-like). No SSH, no persistent volumes. One-shot `docker run --rm` with stdout + exit code streamed back.
- **Pricing**: **platform-set** per GPU-hour in v1 (see ADR-004).
- **Host identity**: visible to the customer as `@handle`. The Arabic mock UI's marketplace of `@ahmad.ml`, `@sara.mlops`, etc. is the product, not a pitch artifact.

## Consequences

**Positive**:
- Community narrative is tangible — *"rent @ahmad.ml's GPU"* is a story a pitch slide can tell.
- Host safety preserved — no attack surface on host PCs, no OS-level access.
- Operational simplicity — one container runtime, no interactive session lifecycle, no SSH key management, no persistent-volume gc.
- Scales to untrusted hosts without rewrite — only the registration and vetting layers would change; the execution boundary is already hardened.

**Negative**:
- Loses long-running interactive workloads (Jupyter sessions, iterative dev, SSH'd debugging). Those customers go to Vast.
- Customer owns output exfiltration (see ADR-003). Higher friction than "SSH in and `scp` the results out."
- Scheduler cannot auto-reroute for reliability — when the customer's picked node is offline, we notify and wait, rather than rerouting.

## Revisit if

- Supply grows past ~100 active nodes and fleet-scheduling becomes commercially more attractive than hand-picking.
- Customer research shows *"just give me a shell"* is a frequent lost-deal reason — consider a second product tier (e.g., pre-vetted commercial-host-only SSH tier) rather than retrofitting the main product.
- A tier of hosts with persistent, always-on hardware (small data centers, KAUST racks) emerges who want to charge a premium — see ADR-004.
