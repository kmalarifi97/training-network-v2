# ADR-003: No platform-owned storage in v1 (customer-owned exfiltration)

**Date**: 2026-04-18
**Status**: Accepted
**Authors**: Khalid

## Context

When a customer's container exits, its writable filesystem is destroyed (the agent runs `docker run --rm` — see `node-agent/internal/agent/daemon.go`). Any model weights, logs, or artifacts saved inside the container evaporate unless exfiltrated before exit.

There are three standard patterns for handling this:

1. **Customer-owned exfiltration**: the customer's script pushes output to their own destination (Hugging Face Hub, GitHub, S3, a webhook, anywhere reachable from the network). Platform passes secrets as env vars. Platform owns zero storage.
2. **Platform-owned artifact store**: platform provides a known mount (e.g., `/artifacts`), captures it on exit via bind-mount, uploads to blob storage, offers a signed "Download" URL in the UI. Platform owns storage, bandwidth, retention, backups, compliance.
3. **Callback / streaming service**: container registers an HTTP endpoint; the "output" is a running service. Not applicable to one-shot jobs.

Pattern 2 is attractive — it unlocks a Saudi data-sovereignty pitch (*"your model weights never leave Saudi Arabia"*) that Salad and Vast cannot credibly claim from US soil. But it turns the platform into a storage provider with the full iceberg:

| What a "simple" download feature ships | What it quietly costs |
|---|---|
| Bind-mount `/artifacts` on each job | Disk-space planning on every host PC |
| Save on exit | Retention policy (7d? 30d? forever? customer-configurable?) |
| Download URL | Bandwidth + GCP egress bill per customer per GB |
| Access control | Signed URLs, audit logs, deletion-on-request |
| "Oh and quotas" | Per-customer storage limits + billing integration |
| "Oh and durability" | Backups, disaster recovery, RPO/RTO |
| "Oh and compliance" | Saudi data-protection law, customer-IP liability |

None of those are optional once a paying customer depends on the feature.

## Decision

For v1 we adopt **pattern 1 only**. The platform:

- Accepts arbitrary env vars at job submission (so customers can pass `HF_TOKEN`, `AWS_ACCESS_KEY_ID`, webhook URLs, etc. — see related implementation task below).
- Exposes outbound network from the container (default Docker networking, not `--network=host`).
- Does **not** persist any file the container produces after the container exits.

We do **not** add platform-owned storage (MinIO sidecar, artifact blob store, signed download URLs, etc.) without a subsequent ADR that answers:

1. **Business reason?** (sovereignty pitch, customer UX, competitive differentiation)
2. **Who pays for storage** — platform or customer?
3. **Retention policy** and per-customer quota?
4. **Durability guarantees** when the control-plane VM reboots?
5. **Deletion-on-request** compliance mechanics?

If we cannot answer those, we are not ready to ship pattern 2.

## Customer-facing guardrail

Because pattern 1 is **invisible by default** ("I ran my job, where's my output?"), the job-submission UI must clearly warn the customer before the job starts. Suggested copy (refine when implemented):

> *The platform does not keep any files produced inside your container. Your script must push its output somewhere (GitHub, Hugging Face Hub, your own S3, a webhook, etc.) before the container exits. Pass credentials as environment variables at job submission.*

**Implementation task** (v1): add this warning to the submission form in the real client UI (when we build it — the current `client-ui/` is a mock and already contains educational copy that partly covers this). Also add an `env` field to `SubmitJobRequest` at `control-plane/app/schemas/jobs.py` so customers can pass secrets per-job without baking them into their Docker image.

## Consequences

**Positive**:
- Platform carries zero storage liability, zero bandwidth cost, zero compliance burden for customer data.
- Simpler failure story — the platform never owns data it can lose.
- Preserves the thin-network-layer identity from ADR-002.
- The UI warning is itself a *pitch asset*: transparency about what we don't store is a trust signal in a market that is (rightly) cautious about clouds touching their data.

**Negative**:
- Higher customer onboarding friction — they must set up their own destination and obtain a token.
- Loses the Saudi data-sovereignty pitch as a day-one differentiator. Deferred, not abandoned.
- Non-technical customers will find "write a script that pushes to S3" intimidating.

## Revisit if

- Data-sovereignty becomes a top-3 loss reason in customer conversations, **and** we have ops/budget headroom to run a durable local artifact store (MinIO on the Doha VM or a dedicated bucket).
- A credible enterprise demand for *"keep my weights in Saudi"* emerges — not just individual researchers.
- Non-technical user research shows exfiltration friction is the primary blocker to adoption.
