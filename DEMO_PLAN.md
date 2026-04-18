# Incubator Demo MVP — Plan

**Sprint:** one week.
**Goal:** a live, working, end-to-end fine-tuning demo for the business incubator presentation.

---

## The demo in one paragraph

A user on their laptop in Riyadh logs into the platform, browses the list of GPU nodes in the network (one today: `oregon-a100`), picks it, pastes a Docker image name + GitHub repo URL into a form, and clicks **Start Processing**. The platform pulls the image onto the Oregon GPU, clones the repo inside the container, fine-tunes a small language model on 10 rows of CSV training data, and streams the loss curve dropping in real time back to the user's screen. A live platform-activity panel narrates the plumbing the whole time: pulling image, assigning node, starting container, training step N, container exited.

## Pitch narrative

> "Saudi Arabia has no in-country GPU cloud. Researchers and Arabic-AI teams pay 200 ms of latency and US-dollar prices to train models 10,000 km away. We're building a regional GPU network — starting with trusted friends, scaling to a marketplace of local contributors. This demo shows a real fine-tuning job running on a real GPU, triggered from my laptop, with every step visible."

---

## User flow (what the demo user does on stage)

1. **Log in** — email + password
2. **Browse available GPUs** — one card today (`oregon-a100`, NVIDIA A100 80 GB)
3. **Pick one** — click *Use this GPU*
4. **Paste Docker image name** — `kmalarifi/llm-finetune:v1`
5. **Paste GitHub repo URL** — `https://github.com/kmalarifi/finetune-demo`
6. **Click Start Processing**
7. **Watch** — two-panel view: training logs (left) + platform activity (right), both live

---

## Architecture — three artifacts, three change cadences

| Artifact | Contents | Rebuilt when |
|---|---|---|
| **Docker image** (environment) | CUDA + PyTorch + transformers + peft + trl | library versions change (rarely) |
| **GitHub repo** (experiment) | `train.py` + `data/train.csv` | per experiment (often) |
| **Job submission** (params) | image name, repo URL, chosen node | per run |

The image is slow to build and push (GBs, minutes). The repo is fast to pull (KBs, seconds). This separation mirrors production ML workflows.

---

## Platform changes from v1

| Change | Where | Owner | Time |
|---|---|---|---|
| Agent log pump (replace `io.Discard`) | `node-agent/internal/agent/daemon.go` | me | ~2 h |
| Split `docker pull` from `docker run` (stream pull progress) | same | me | ~1 h |
| Allow `stream=system` on job logs | `control-plane/app/schemas/job_logs.py` | me | ~15 m |
| `preferred_node_id` on `Job` (optional node-picking) | Alembic migration + job_repo + schema | me | ~1 h |
| UI: real login page (remove hardcoded creds) | `client-ui/app/` | me | ~1 h |
| UI: browse GPUs + pick | new route | me | ~1.5 h |
| UI: submit training job + live logs | new route | me | ~2.5 h |

Total platform code: ~9 focused hours, 3–4 evenings.

---

## Task tracks

| Track | Owner | What | Hours |
|---|---|---|---|
| **A** | you | Build + push Docker image (`kmalarifi/llm-finetune:v1`) to Docker Hub | ~1 |
| **B** | you | Create GitHub repo `finetune-demo` with `train.py` + `data/train.csv` (10 rows) | ~2 |
| **C** | me | Agent log pump + pull/run split in `daemon.go` | ~3 |
| **D** | me | Platform UI: login → browse GPUs → submit job → live view | ~5 |
| **E** | me | `preferred_node_id` schema change + scheduler filter | ~1 |
| **F** | you | Demo rehearsal on Oregon VM (day before) | ~1 |

---

## Implementation order

**Evening 1 (tonight):**
- **You:** Track A (Docker image) + Track B (GitHub repo) on your laptop
- **Me:** Track C (agent log pump + pull/run split)

**Evening 2:**
- **Me:** Track E (schema) + start Track D (UI)

**Evening 3:**
- **Me:** finish Track D
- **Both:** first end-to-end smoke test via Swagger + UI

**Evening 4 (rehearsal):**
- **You:** Track F — rehearse the full demo 3× on Oregon
- **Both:** fix anything that broke in rehearsal

---

## The demo container (Track A reference)

### Dockerfile

```dockerfile
FROM nvidia/cuda:12.2.0-devel-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt update && apt install -y --no-install-recommends \
    python3.11 python3-pip git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu121
RUN pip install --no-cache-dir \
    transformers>=4.45 accelerate peft trl datasets pandas
WORKDIR /workspace
```

Build + push:
```
docker build -t kmalarifi/llm-finetune:v1 .
docker push kmalarifi/llm-finetune:v1
```

## The demo experiment (Track B reference)

Repo layout:
```
finetune-demo/
├── train.py
└── data/
    └── train.csv
```

`train.py` fine-tunes TinyLlama-1.1B with LoRA adapters on 10 rows of
instruction/response pairs from `data/train.csv`, logs loss per step, saves
the adapter to `./output` on completion.

`data/train.csv` — two columns, 10 rows of Saudi-themed Q&A, e.g.:
| instruction | response |
|---|---|
| What is the capital of Saudi Arabia? | Riyadh. |
| What is Saudi Arabia's currency? | Saudi Riyal (SAR). |
| What is Vision 2030? | A Saudi initiative to diversify the economy beyond oil. |
| *...7 more rows* | |

## What a job submission looks like (platform contract)

```json
{
  "docker_image": "kmalarifi/llm-finetune:v1",
  "command": [
    "bash", "-c",
    "git clone https://github.com/kmalarifi/finetune-demo repo && cd repo && python3 train.py --epochs 3"
  ],
  "gpu_count": 1,
  "max_duration_seconds": 600,
  "preferred_node_id": "<oregon-a100 UUID>"
}
```

---

## Demo-day checklist

- [ ] Oregon VM started and warm (agent process running)
- [ ] Docker image pre-pulled on Oregon so no GB-scale download during the demo
- [ ] Platform control plane reachable at the public URL
- [ ] Test job succeeded end-to-end within the last hour
- [ ] Browser window sized for the projector
- [ ] Login credentials memorized
- [ ] Image name + repo URL ready to paste
- [ ] Backup screenshot of a successful run (in case the live demo fails)

---

## Not in scope this week

- Multi-replica services / container gateway / inbound reverse proxy
- NAT traversal for home-PC hosting (public-IP nodes only for now)
- Billing UI for renters
- Tests for new code (add after the demo)
- Production-grade login (no reset, no email verification)
- Agent output streaming via WebSocket (polling is enough for the demo)
