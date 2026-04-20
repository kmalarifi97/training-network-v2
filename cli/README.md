# gpunet-cli

Command-line interface for the GPU Network platform. Built for humans and
for coding agents (Claude Code, Cursor, etc.).

The platform is workload-agnostic (see `/CLAUDE.md` invariant #1) — this CLI
submits containers, it does not assume what the container does.

## Install (end-users)

```bash
pip install gpunet-cli
```

(During development: `pip install -e ./cli` from the repo root, or use the
Docker dev path below.)

## Authenticate

Generate an API key in the platform UI, then:

```bash
gpunet auth set-key gpuk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx --url https://<platform-url>
gpunet auth whoami
```

Environment overrides (unix-style precedence: env > config file > default):

- `GPUNET_API_KEY`
- `GPUNET_URL`

## Commands

| Command | Purpose |
|---|---|
| `gpunet auth set-key / whoami / logout` | Credential management |
| `gpunet nodes list` | Nodes you own |
| `gpunet nodes marketplace` | All online nodes (Vast-style browse) |
| `gpunet nodes show <id>` | Node detail |
| `gpunet jobs submit --image … --cmd … --node …` | Raw job submit |
| `gpunet jobs run --repo … --entrypoint … --image … --node … --wait` | Clone + run + (optional) wait |
| `gpunet jobs list / status / cancel / logs` | Inspect and control jobs |
| `gpunet keys create / list / revoke` | API key management |
| `gpunet install skill` | Install Claude Code skill |
| `gpunet --json <any-command>` | Machine-readable JSON output |

## For agents (Claude Code)

After installing the CLI, also install the skill:

```bash
gpunet install skill
```

This copies `SKILL.md` to `~/.claude/skills/gpu-network/` so Claude Code
auto-discovers it. The skill is workload-agnostic: it knows how to submit
any container, not specific frameworks.

## Development (Docker — project rule #9)

CLAUDE.md rule: "All Python runs in Docker." For CLI development:

```bash
# Build dev image
docker build -t gpunet-cli-dev ./cli

# Run any gpunet command through it (mount your config so auth persists)
docker run --rm -v "$HOME/.gpunet:/root/.gpunet" -v "$HOME/.claude:/root/.claude" \
  --network host gpunet-cli-dev --help
```

End-users install on the host with `pip install gpunet-cli` — that is their
environment, not ours. The Docker rule applies to repo development.

## Layout

```
cli/
├── Dockerfile               dev-only image (rule #9)
├── pyproject.toml           installs `gpunet` entry point, bundles skills/
├── gpunet_cli/
│   ├── main.py              Typer root + global --json flag
│   ├── client.py            httpx wrapper around REST API (the contract)
│   ├── config.py            ~/.gpunet/config.yaml
│   ├── output.py            emit() / error() — JSON vs human rendering
│   └── commands/
│       ├── auth.py          set-key / whoami / logout
│       ├── nodes.py         list / marketplace / show
│       ├── jobs.py          submit / run / list / status / cancel / logs
│       ├── keys.py          create / list / revoke
│       └── install.py       skill installer
└── skills/gpu-network/SKILL.md     workload-agnostic agent instructions
```
