# Install flow review — 2026-04-19

A review note from Claude so the evaluating agent can see the reasoning behind
the diff without having to infer it from the code. Every decision below is
load-bearing; flag any you disagree with.

---

## The user's stated goal

> Make the installation process smooth — the more separate installations, the
> more it gets complicated, especially for MVP.

Reworded: a host with a Windows + NVIDIA GPU should go from zero to a running
agent with the fewest copy-paste blocks possible. "Paste one line, answer any
prompts, be done" is the target.

---

## What was wrong with `control-plane/public/install.sh` before

Two concrete issues vs. that goal:

1. **Interactive `read -r -p "Continue anyway? [y/N]"` prompts** at lines
   55 and 64 (pre-rewrite). When a host runs
   `curl -fsSL .../install.sh | sudo bash`, stdin is the piped script itself,
   not the terminal — `read` silently consumes the next line of the script as
   the answer and yields whatever that line's first character is. Classic
   `curl | bash` bug. The prompts either auto-"N" (fail) or auto-"y" (continue
   with a corrupted script body already partly consumed).

2. **Not one-shot.** The script only handled the agent binary + systemd unit.
   Docker Engine + NVIDIA Container Toolkit were a separate 20-line shell
   block the host had to paste by hand in `docs/host-onboarding-wsl.md` Step 2.
   Every extra paste is an opportunity to paste wrong.

---

## Changes in this diff

### `control-plane/public/install.sh` — rewritten

1. **Removed the interactive `read` prompts.** Replaced with loud `warn` lines
   that print and continue. A non-NVIDIA host finishes installing the agent;
   `gpu-agent init` will fail later with a clearer error (nvidia-smi missing)
   and the host can fix the driver then. Failing loud at registration time is
   better than failing silently on a broken `read`.

2. **Added Docker Engine install.** Uses the official
   `curl -fsSL https://get.docker.com | sh` one-liner. Guarded by a prior
   `command -v docker` check so re-running is idempotent. Docker is then
   `systemctl enable --now`'d.

3. **Added NVIDIA Container Toolkit install.** Straight out of NVIDIA's official
   docs: keyring into `/usr/share/keyrings/…`, sources list into
   `/etc/apt/sources.list.d/nvidia-container-toolkit.list`, then
   `apt-get install -y nvidia-container-toolkit` and
   `nvidia-ctk runtime configure --runtime=docker` + `systemctl restart docker`
   to wire the `--gpus all` flag. Guarded by `command -v nvidia-ctk` to stay
   idempotent on re-run.

4. **Added WSL-aware systemd pre-flight.** `systemctl is-system-running` is
   checked; if it's offline and we're inside WSL, the script prints the exact
   three-step fix (write `/etc/wsl.conf`, `wsl --shutdown`, reopen) and exits
   non-zero. If we're not in WSL but systemd isn't running, we die. "Degraded"
   is treated as acceptable — that just means some unrelated unit is sad, not
   that systemd is broken.

5. **Added distro detection.** Only Ubuntu / Debian are accepted
   (`ID` / `ID_LIKE` from `/etc/os-release`). Everything else dies with a
   clear message. This mirrors what the docs already promised.

6. **Binary download hardening.** `file "$TMP_BIN" | grep -q 'ELF'` ensures
   we don't silently install an HTML error page as the binary. `[[ -s ]]`
   rejects zero-byte downloads. A running `gpu-agent.service` is stopped
   before the binary is replaced so the swap is atomic.

7. **Added `--skip-docker` and `--skip-nvidia` flags.** Not for the customer;
   for anyone retrying the installer on a box that already has a working
   stack. Zero-impact when unused.

What I deliberately **kept** the same:

- `CONTROL_PLANE` default (`http://34.18.164.66:8000`) and the
  `GPU_AGENT_CONTROL_PLANE` env override and the `--control-plane=` flag.
- `/public/gpu-agent-linux-amd64` binary URL pattern.
- `/usr/local/bin/gpu-agent` binary path, `/etc/gpu-agent/config.json`
  config path, `/etc/systemd/system/gpu-agent.service` service path.
- The systemd unit contents (same `After=`, `Requires=`, `Restart=on-failure`,
  `User=root`, `ExecStart=` — byte-for-byte the same unit as before, so
  existing registered hosts don't see behavior drift on upgrade).
- "Install but don't auto-start" — the script still leaves `gpu-agent init`
  and `systemctl enable --now` to the host, because `init` needs a
  claim-token argument we can't get from a pipe.

### `docs/host-onboarding-wsl.md` — simplified

- Old Step 2 (20-line Docker + NVIDIA paste block) is gone; that's now the
  installer's job.
- New Step 2 is only the systemd-in-WSL toggle (3 lines + one PowerShell
  command), because WSL needs a distro restart for `systemd=true` to take
  effect — the installer can't do it from inside.
- Step 3 is now "run the installer" alone.
- The `docker run --rm --gpus all ...` smoke test is kept, moved after the
  installer finishes.
- One troubleshooting line updated: `service docker start` → `systemctl
  start docker`, since we're now committed to systemd.

---

## What this diff does NOT touch

So the evaluator can see the surface I stayed off:

- No FastAPI code changed (no new routes, no changes to `/public` mount).
- No Dockerfile changes.
- No `docker-compose.yml` changes.
- No `deploy.sh` changes (it still `gcloud scp`s the built binary to the
  control-plane public dir, which is exactly what the installer expects).
- No `node-agent/` (Go) code changed. `gpu-agent` semantics unchanged.
- No Python tests added or removed. Existing tests should still pass —
  nothing they cover is in scope of this diff.
- No ADRs added or superseded (this is not an architectural change).

---

## Known risks / untested areas

1. **Not yet test-run on real WSL2 Ubuntu.** Per user instruction, the push
   happens before live-testing. A follow-up session (or this one) will
   `wsl --install -d Ubuntu` on this Windows box and run the installer
   end-to-end. If the systemd pre-flight check's "degraded" special case is
   wrong in practice, or if `get.docker.com` breaks in WSL, we'll learn
   then and iterate.

2. **`get.docker.com` pins to whatever version upstream ships.** Stable
   Docker, but it's a moving target. If Docker Inc. starts gating it, the
   install breaks. The alternative (apt repo setup inline) is what the old
   docs Step 2 did and is longer but reproducible. Choice: smoothness >
   reproducibility for MVP.

3. **`systemctl restart docker` after wiring nvidia runtime** briefly kills
   any running containers. On a fresh host nothing is running yet, so this
   is fine for the install case, but re-running the installer on a live
   host would hiccup jobs. Acceptable for MVP.

4. **No signature / hash verification of the agent binary.** The `file | grep
   ELF` check catches HTML error pages but not a malicious replacement
   upstream. If the control-plane host is trusted as the install vector,
   that's consistent with the existing model. Would belong in a follow-up
   if v1 opens to untrusted contributors.

5. **Only x86_64.** arm64 is an `exit 1` with a clear message. Fine for v1.

---

## Bugs found and fixed during real-host testing

1. **`nvidia-smi` invisible to sudo on WSL2** — agent under systemd died with
   `GPU detection failed: nvidia-smi not found on PATH`, even though running
   `nvidia-smi` as the user worked. Cause: CUDA-on-WSL ships `nvidia-smi` at
   `/usr/lib/wsl/lib/nvidia-smi`, which is on the interactive user's PATH but
   not on sudo's `secure_path`. Fix in `install.sh`: when running under WSL,
   symlink `/usr/lib/wsl/lib/nvidia-smi → /usr/local/bin/nvidia-smi` after
   the toolkit step. Without this, **every WSL host hits the bug** — `init`
   fails, the systemd service restart-loops, the node never appears in the
   UI, and the customer has no clue why.

## Follow-ups surfaced during real-host testing

Track these so they don't get re-discovered by every customer.

1. **`wsl --install -d Ubuntu` is not always one-shot on clean Windows.**
   On at least some Windows 11 hosts a single Admin-PowerShell run of
   `wsl --install -d Ubuntu` enables the WSL platform + reboots, but
   leaves the distro list empty after the reboot. `wsl -l -v` then says
   "Windows Subsystem for Linux has no installed distributions." The
   recovery is a second `wsl --install Ubuntu` (no -d, no admin needed)
   which downloads the rootfs and launches the first-run user wizard.

   This isn't our installer's bug, it's a Microsoft-side rough edge —
   but it's the single biggest friction point in the onboarding chain
   so far. Worth either:
   - Documenting prominently in `docs/host-onboarding-wsl.md` (a "if
     after reboot you don't see Ubuntu, run this" callout), and/or
   - Shipping a `setup-wsl.ps1` companion that polls until the distro
     appears and re-issues the install if not, so the customer only
     pastes one command.

2. **Customer flow still requires two distinct shells** (PowerShell for
   WSL install, then Ubuntu for the agent install). Confused at least
   one tester ("where do I paste these?"). The PowerShell companion
   script in (1) would also let us inline a one-line "now open Ubuntu
   and paste this" prompt at the end.

3. **Live `/public/install.sh` lags `mvp` until `deploy.sh` runs.**
   The push-then-test loop wants either an auto-deploy on push, or a
   way to test the new script without rolling it to live (curl from
   GitHub raw works as a stopgap; documented in the test command).

## Files touched

```
M  control-plane/public/install.sh     # rewrite: +one-shot, -interactive prompts, +systemd check
M  docs/host-onboarding-wsl.md         # collapse old Step 2 into installer; add systemd-in-WSL step
A  INSTALL_REVIEW.md                   # this file
```

No other paths in the tree should differ from the base of mvp.
