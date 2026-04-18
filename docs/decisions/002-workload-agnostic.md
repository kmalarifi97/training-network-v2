# ADR-002: Workload-agnostic — thin network layer, not an AI platform

**Date**: 2026-04-18
**Status**: Accepted
**Authors**: Khalid

## Context

At the moment of every feature request, there is commercial pressure to build something workload-specific: an inference endpoint helper, a RAG template, a Stable Diffusion one-click, `HF_TOKEN` as a first-class field on the job schema, LLM-specific parameters (context length, temperature, batch size, adapter paths). Each one individually looks like a free win — it makes a specific customer's demo shorter.

The cumulative effect turns the platform from *"rent a GPU to run a container"* into *"an AI platform with opinions about what you run."* That is a different product, a different competitor set (Modal, Replicate, Together), and a far larger engineering surface that we cannot staff.

## Decision

The platform is a **container scheduling and routing layer**. It is aware of:

- Docker images and commands
- GPU counts and memory
- Job lifecycle (queued / running / complete / failed / cancelled)
- Generic env vars (opaque strings — the platform does not interpret their names)
- Host identity and health

It is **not** aware of:

- Models, tokens, prompts, context windows, inference parameters
- Training, inference, fine-tuning as distinct concepts in the API
- Any specific ML library, framework, or artifact format
- Any specific cloud storage provider, hub, or webhook destination

Anything workload-specific belongs **outside the platform** — in example scripts, example Docker images, or a future SDK that customers opt into. Not in the platform code.

## Consequences

**Positive**:
- Engineering surface stays small. No ML feature backlog to chase every time a specific framework releases something new.
- Platform is reusable beyond AI (rendering, scientific computing, any containerized GPU work). Widens the addressable market without new code.
- Workload-specific helpers can be published separately as example repos or a thin SDK layer without coupling them to the scheduler, billing, or auth.
- Stable contract for hosts — they run Docker containers, nothing more. No risk of a platform update requiring them to upgrade drivers or add libraries.

**Negative**:
- Customers handle their own Docker image, env vars, and exfiltration. Higher onboarding friction than a workload-specific competitor that ships a one-line `modal.run("train", ...)` helper.
- Harder to build compelling demos without a workload wrapper. We've accepted this by putting the LoRA fine-tune script in an *example Docker image* (`kmalarifi/llm-finetune:v1`), not in platform code — see `DEMO_PLAN.md`.
- Some commercial opportunities (turnkey inference hosting, managed training) are structurally out of scope.

## Revisit if

- Customer research shows onboarding friction is the primary loss reason, **and** a thin workload-specific helper layer (published as a separate SDK or example gallery, NOT as platform code) fails to close the gap.
- The distinction between *platform* and *SDK* becomes blurry and we start absorbing SDK concerns into the platform — supersede this ADR with a formal layering decision.
