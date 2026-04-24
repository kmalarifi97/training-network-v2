#!/usr/bin/env bash
# GPU Network agent installer — Linux / WSL2 Ubuntu
#
# One-shot: installs Docker Engine (if missing), NVIDIA Container Toolkit
# (if missing), the gpu-agent binary, and a systemd unit. After this the
# host runs `gpu-agent init ...` then `systemctl enable --now gpu-agent`.
#
# Usage:
#   curl -fsSL http://34.18.164.66:8000/public/install.sh | sudo bash
#
# Override the control plane (e.g. pointing at a local stack):
#   curl -fsSL .../install.sh | sudo bash -s -- --control-plane=http://localhost:8000

set -euo pipefail

CONTROL_PLANE="${GPU_AGENT_CONTROL_PLANE:-http://34.18.164.66:8000}"
BIN_PATH="/usr/local/bin/gpu-agent"
CONFIG_DIR="/etc/gpu-agent"
CONFIG_PATH="${CONFIG_DIR}/config.json"
SERVICE_PATH="/etc/systemd/system/gpu-agent.service"
SKIP_DOCKER=0
SKIP_NVIDIA=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --control-plane=*) CONTROL_PLANE="${1#*=}"; shift ;;
        --skip-docker)     SKIP_DOCKER=1; shift ;;
        --skip-nvidia)     SKIP_NVIDIA=1; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

CONTROL_PLANE="${CONTROL_PLANE%/}"
BINARY_URL="${CONTROL_PLANE}/public/gpu-agent-linux-amd64"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# --- sanity ---

[[ $EUID -eq 0 ]] || die "run as root — re-run with: sudo bash install.sh"
[[ "$(uname -s)" == "Linux" ]] || die "gpu-agent is Linux-only (WSL2 Ubuntu on Windows is supported)"
[[ "$(uname -m)" == "x86_64" ]] || die "gpu-agent currently only supports x86_64 (amd64)"

if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
fi
case "${ID:-}${ID_LIKE:-}" in
    *ubuntu*|*debian*) ;;
    *) die "only Ubuntu/Debian are supported (detected ${ID:-unknown})" ;;
esac

IS_WSL=0
if grep -qi microsoft /proc/version 2>/dev/null || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
    IS_WSL=1
fi

command -v systemctl >/dev/null 2>&1 || die "systemctl not found — this installer requires systemd"

# `is-system-running` exits 0 on running/degraded, non-zero on offline/stopping/etc.
# "degraded" is fine for installation (some services might not be up yet).
if ! systemctl is-system-running >/dev/null 2>&1; then
    state="$(systemctl is-system-running 2>/dev/null || true)"
    # Treat "degraded" as acceptable; everything else with a non-zero exit is a hard fail.
    if [[ "$state" != "degraded" ]]; then
        if [[ $IS_WSL -eq 1 ]]; then
            cat >&2 <<EOF
systemd is not active inside this WSL distro (state: ${state:-unknown}).

Enable it once:
  1. In Ubuntu:
       sudo tee /etc/wsl.conf >/dev/null <<CONF
       [boot]
       systemd=true
       CONF

  2. In PowerShell (on Windows):
       wsl --shutdown

  3. Reopen Ubuntu and re-run this installer.
EOF
            exit 1
        fi
        die "systemd is not running (state: ${state:-unknown})"
    fi
fi

# --- base tools ---

log "Installing base tools (curl, ca-certificates, gnupg, file)"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl ca-certificates gnupg file

# --- Docker Engine ---

if [[ $SKIP_DOCKER -eq 0 ]]; then
    if command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1; then
        log "Docker already installed ($(docker --version))"
    else
        log "Installing Docker Engine (get.docker.com)"
        curl -fsSL https://get.docker.com | sh
    fi
    if ! systemctl is-active --quiet docker; then
        log "Enabling + starting docker.service"
        systemctl enable --now docker || die "failed to start docker.service"
    fi
fi

# --- NVIDIA Container Toolkit ---

if [[ $SKIP_NVIDIA -eq 0 ]]; then
    if command -v nvidia-ctk >/dev/null 2>&1; then
        log "NVIDIA Container Toolkit already installed"
    else
        log "Installing NVIDIA Container Toolkit"
        KEYRING="/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg"
        LIST="/etc/apt/sources.list.d/nvidia-container-toolkit.list"
        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
            | gpg --dearmor --yes -o "$KEYRING"
        curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
            | sed "s#deb https://#deb [signed-by=${KEYRING}] https://#g" \
            > "$LIST"
        DEBIAN_FRONTEND=noninteractive apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nvidia-container-toolkit
    fi
    log "Wiring nvidia runtime into docker"
    nvidia-ctk runtime configure --runtime=docker >/dev/null
    systemctl restart docker
fi

# --- WSL: ensure nvidia-smi is reachable under sudo's secure_path ---
# Inside WSL, the CUDA-on-WSL nvidia-smi lives at /usr/lib/wsl/lib/, which is
# on the user's PATH but NOT on sudo's default secure_path. The agent runs
# under systemd (effectively root) and would fail with "nvidia-smi not found"
# until we surface the binary at a standard location.
if [[ $IS_WSL -eq 1 && -x /usr/lib/wsl/lib/nvidia-smi && ! -e /usr/local/bin/nvidia-smi ]]; then
    log "Symlinking WSL nvidia-smi → /usr/local/bin/nvidia-smi (so root/systemd can find it)"
    ln -s /usr/lib/wsl/lib/nvidia-smi /usr/local/bin/nvidia-smi
fi

# --- GPU sanity ---

if ! command -v nvidia-smi >/dev/null 2>&1; then
    warn "nvidia-smi not found — the agent will fail to register until the NVIDIA driver is installed (on the Windows host for WSL2, or the Linux host directly)."
elif ! nvidia-smi -L >/dev/null 2>&1; then
    warn "nvidia-smi is present but cannot query a GPU"
else
    log "GPU visible: $(nvidia-smi -L | head -n1)"
fi

# --- agent binary ---

log "Downloading gpu-agent from ${BINARY_URL}"
TMP_BIN="$(mktemp)"
trap 'rm -f "$TMP_BIN"' EXIT
if ! curl -fsSL "${BINARY_URL}" -o "${TMP_BIN}"; then
    die "failed to download ${BINARY_URL}"
fi
[[ -s "$TMP_BIN" ]] || die "downloaded binary is empty"
file "$TMP_BIN" | grep -q 'ELF' || die "downloaded file is not an ELF binary"

if systemctl is-active --quiet gpu-agent 2>/dev/null; then
    log "Stopping running gpu-agent for binary replacement"
    systemctl stop gpu-agent
fi
install -m 0755 "$TMP_BIN" "$BIN_PATH"
log "Installed gpu-agent → ${BIN_PATH}"

# --- config dir ---

mkdir -p "${CONFIG_DIR}"
chmod 700 "${CONFIG_DIR}"

# --- systemd unit ---

log "Writing systemd unit to ${SERVICE_PATH}"
cat > "${SERVICE_PATH}" <<UNIT
[Unit]
Description=GPU Network Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
ExecStart=${BIN_PATH} start --config=${CONFIG_PATH}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "${SERVICE_PATH}"
systemctl daemon-reload

# --- device-code onboarding ---
#
# Skip `gpu-agent login` if this machine is already registered (re-install
# case) — the existing token is still valid.

ALREADY_REGISTERED=0
if [[ -s "$CONFIG_PATH" ]] && grep -q '"agent_token"' "$CONFIG_PATH" 2>/dev/null; then
    ALREADY_REGISTERED=1
fi

if [[ $ALREADY_REGISTERED -eq 1 ]]; then
    log "This machine is already registered (${CONFIG_PATH} has an agent token)."
else
    # If a wrapper installer (e.g. the Windows .exe) pre-created the device
    # code, it passes the polling token through the environment and already
    # opened the browser for the user. In that mode we skip the banner and
    # just poll. Otherwise we fall back to the standalone flow where the
    # agent itself creates the code and prints a visit-this-URL prompt.
    LOGIN_ARGS=(login "--control-plane=${CONTROL_PLANE}" "--config=${CONFIG_PATH}")
    if [[ -n "${GPU_AGENT_POLLING_TOKEN:-}" ]]; then
        log "Polling for device approval (code was created by the installer)."
        LOGIN_ARGS+=("--polling-token=${GPU_AGENT_POLLING_TOKEN}")
    else
        log "Starting device-code onboarding. A short code will appear below —"
        log "open it in your browser on any device, sign in, and approve."
        echo
    fi
    if ! "${BIN_PATH}" "${LOGIN_ARGS[@]}"; then
        cat >&2 <<EOF

!! gpu-agent login did not complete. The binary and systemd unit are
!! installed, so you can finish later by running:

    sudo ${BIN_PATH} login --control-plane=${CONTROL_PLANE} --config=${CONFIG_PATH}
    sudo systemctl enable --now gpu-agent

EOF
        exit 1
    fi
fi

# --- enable service ---

log "Enabling gpu-agent.service"
systemctl enable --now gpu-agent

cat <<EOF

==> gpu-agent installed and running.

Check it:
    sudo systemctl status gpu-agent
    sudo journalctl -u gpu-agent -f

EOF
