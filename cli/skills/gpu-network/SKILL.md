---
name: gpu-network
description: Run Docker containers on remote GPUs via the GPU Network
  platform. Use when the user wants to execute any containerized workload
  on a GPU they don't own locally — batch jobs, compute-heavy scripts,
  long-running processes — and needs the image + command submitted, logs
  streamed, and status tracked.
---

# GPU Network

This skill submits and manages container jobs through the `gpunet` CLI. The
platform is workload-agnostic: it sees containers, images, and exit codes —
nothing about what the container does.

## Prerequisites

The user must have already run:

```bash
pip install gpunet-cli
gpunet auth set-key gpuk_... --url https://<their-platform-url>
```

If `gpunet auth whoami` fails, ask them to set their key before proceeding.

## Core workflow

Always pass `--json` so you get structured output to reason about.

### 1. Browse GPUs available on the network

```bash
gpunet --json nodes marketplace
```

Returns online nodes with host handle (e.g. `@ahmad.ml`), GPU model, count,
and node UUID. The user picks which host to run on — node selection is a
user decision, not the platform's.

### 2. Submit a job on a specific node

```bash
gpunet --json jobs submit \
  --image <image>:<tag> \
  --cmd '<shell command to run inside the container>' \
  --gpus <n> \
  --max-seconds <n> \
  --node <node-uuid>
```

The container runs with stdout/stderr captured. When it exits, `status`
becomes `completed` (exit 0) or `failed`. No persistent storage, no SSH,
no network-host, no privileged — one-shot container only.

### 3. Submit with a git clone shortcut (high-level)

When the user wants to run code from a repo:

```bash
gpunet --json jobs run \
  --repo <git-url> \
  --entrypoint '<command to run after cloning>' \
  --image <image>:<tag> \
  --gpus <n> \
  --max-seconds <n> \
  --node <node-uuid> \
  --wait
```

`--wait` blocks until the job reaches a terminal state. Without it, returns
immediately with `status: queued`.

### 4. Inspect jobs

```bash
gpunet --json jobs list [--status running]
gpunet --json jobs status <job_id>
gpunet jobs logs <job_id> [--follow]
gpunet --json jobs cancel <job_id>
```

Logs are polled at ~2s intervals with `--follow`, not streamed.

## Choosing the image

The platform does not supply or recommend images. If the user doesn't have
an image, ask them for one (or ask them to build and push to a registry).
Do not assume the workload type from the task description.

## Platform boundaries the user should understand

- **Output exfiltration is the container's job.** No built-in S3 upload,
  no artifact storage. If the user wants output saved, their container
  must push it somewhere itself (their registry, their bucket, their call).
- **The node the user picked is the node the job runs on.** If that node
  goes offline while the job is queued, the job stays queued on that node
  — the platform does not reassign. Surface this to the user.
- **Credits are GPU-hours.** `gpu_count × max_duration_seconds / 3600` is
  reserved at submit time. Insufficient credits returns HTTP 402.

## Error handling

- `No API key configured` → user hasn't run `gpunet auth set-key`
- `HTTP 401` → API key invalid or revoked
- `HTTP 402` → insufficient GPU-hour credits
- `HTTP 403 pending user` → account awaiting admin approval
- `HTTP 404 on job` → wrong id or not owned by this user
- `HTTP 409 on node delete` → node has a running job; drain first

## When NOT to use this skill

- The user wants to run something on their own machine — shell out locally
- The user is asking questions about the platform's architecture or pricing
  — point them at the platform docs, not this skill
- The user wants to store artifacts on the platform — not supported; their
  container must push outputs itself
