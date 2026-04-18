# Project Principles

Imperative rules for this repo. Read before implementing. Each rule names the specific drift it prevents.

When a new architectural decision is made, add an ADR under `docs/decisions/`. When a rule in this file changes, update it here **and** supersede the relevant ADR (ADRs are immutable — superseded by a new one, never edited).

## Architectural invariants

Hard constraints. Reject code, features, or schemas that violate them — regardless of customer pressure or implementation convenience.

1. **No workload assumptions.** Reject any field, route, or service name that implies *what* the container does (`model_name`, `prompt_template`, `is_inference`, `HF_TOKEN` as a first-class field). The platform sees containers, not workloads. *(ADR-002)*

2. **Output exfiltration is the customer's problem.** Platform provides env vars for secrets, nothing else. No built-in S3 integration, no GitHub push helpers, no artifact storage. *(ADR-003)*

3. **Hybrid marketplace model.** Customer picks the node (`preferred_node_id`, Vast-like). Execution is container-only (Salad-like). Pricing is platform-set in v1. *(ADR-001, ADR-004)*

4. **No SSH to nodes, ever.** No persistent volumes. One-shot container + stdout + exit code + optional bound artifact dir. This is a security and legal boundary — hosts are home PCs owned by people we are not responsible for. *(ADR-001)*

5. **Host identity is visible to the customer.** Show the host handle (`@ahmad.ml`), not an anonymized node ID. The marketplace feel is our differentiator from Salad — don't abstract it into fungible capacity. *(ADR-001)*

6. **`preferred_node_id` is a contract.** Queue the job against the customer's pick. Do not auto-reassign if the preferred node is offline — surface the state to the customer and let them decide to wait, cancel, or pick another. No "smart scheduler" overrides of user intent.

7. **Container isolation is load-bearing.** No `--privileged`, no `--network=host`, no arbitrary host bind-mounts. New mount types or capability additions require an ADR. Host safety is a hard boundary — one escape is catastrophic.

8. **Four auth identities never interchange.** User JWT, user API key, agent token (`gpuagent_…`), admin flag. Each endpoint accepts exactly one identity type. Tests verify each endpoint rejects the wrong credential type.

## Workflow discipline

Habits that protect quality. Less rigid than invariants — deviations should be deliberate and rare, not reflexive.

9. **All Python runs in Docker.** No local venv, not for running, not for type-checking, not "just for a quick script."

10. **New HTTP endpoints ship with integration tests.** Minimum bar: happy path + auth-rejection for each credential type that shouldn't reach it.

11. **`client-ui/` is a pitch mock (no `fetch` calls).** `admin-ui/` is the real UI backed by the live API. Do not wire the mock to the real API without a deliberate decision — the mock's data shape may not match the server's, and the mock is optimized for a demo script, not for production correctness.

12. **Story-contract diagrams stay business-level.** Flowcharts and sequence diagrams show user clicks and outcomes — never POSTs, DB operations, or service names. Those belong in code, not in a diagram for stakeholders.

## Decisions log

Material decisions that might evolve are captured as ADRs in `docs/decisions/`:

- `001-hybrid-marketplace.md` — Salad vs Vast framing and our choice
- `002-workload-agnostic.md` — thin network layer, not an AI platform
- `003-no-platform-storage-v1.md` — pattern 1 (customer-owned exfiltration) + UI alert
- `004-pricing.md` — platform-set per GPU-hour for v1
