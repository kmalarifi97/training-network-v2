#!/usr/bin/env bash
# GPU Network agent installer — Linux / WSL2 Ubuntu
#
# Usage:
#   curl -fsSL http://34.18.164.66:8000/public/install.sh | sudo bash
#
# Optional override:
#   curl -fsSL .../install.sh | sudo bash -s -- --control-plane=http://your-host:8000

set -euo pipefail

CONTROL_PLANE="${GPU_AGENT_CONTROL_PLANE:-http://34.18.164.66:8000}"
BIN_PATH="/usr/local/bin/gpu-agent"
CONFIG_DIR="/etc/gpu-agent"
CONFIG_PATH="${CONFIG_DIR}/config.json"
SERVICE_PATH="/etc/systemd/system/gpu-agent.service"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --control-plane=*) CONTROL_PLANE="${1#*=}"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

BINARY_URL="${CONTROL_PLANE}/public/gpu-agent-linux-amd64"

# --- sanity ---

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: run as root. Re-run with: sudo bash install.sh" >&2
    exit 1
fi
if [[ "$(uname -s)" != "Linux" ]]; then
    echo "ERROR: gpu-agent is Linux-only (WSL2 Ubuntu on Windows is supported)." >&2
    exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
    echo "ERROR: gpu-agent currently only supports x86_64 (amd64)." >&2
    exit 1
fi

# --- prereqs ---

need_curl=$(command -v curl >/dev/null 2>&1 || echo missing)
if [[ "$need_curl" == "missing" ]]; then
    echo "ERROR: curl is required. Install: apt install curl" >&2
    exit 1
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "WARNING: nvidia-smi not found on PATH. GPU detection will fail."
    echo "  WSL2 users: install the NVIDIA CUDA-on-WSL driver on the Windows side:"
    echo "  https://docs.nvidia.com/cuda/wsl-user-guide/"
    echo ""
    read -r -p "Continue anyway? [y/N] " yn
    [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "WARNING: docker is required to run jobs but not installed."
    echo "  Install: https://docs.docker.com/engine/install/ubuntu/"
    echo "  Then inside WSL: sudo apt install -y nvidia-container-toolkit"
    echo ""
    read -r -p "Continue anyway? [y/N] " yn
    [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 1
fi

# --- download binary ---

echo "==> Downloading gpu-agent from ${BINARY_URL}"
TMP_BIN="$(mktemp)"
curl -fsSL "${BINARY_URL}" -o "${TMP_BIN}"
chmod +x "${TMP_BIN}"
mv "${TMP_BIN}" "${BIN_PATH}"
echo "    Installed to ${BIN_PATH}"

# --- config dir ---

mkdir -p "${CONFIG_DIR}"
chmod 700 "${CONFIG_DIR}"

# --- systemd unit ---

echo "==> Writing systemd unit to ${SERVICE_PATH}"
cat > "${SERVICE_PATH}" <<'UNIT'
[Unit]
Description=GPU Network Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/gpu-agent start --config=/etc/gpu-agent/config.json
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload

# --- done ---

cat <<EOF

==> gpu-agent installed.

Next steps:

  1. Register this machine with the claim token from the web UI:
       sudo gpu-agent init \\
           --config=${CONFIG_PATH} \\
           --control-plane=${CONTROL_PLANE} \\
           --claim-token=<YOUR_TOKEN>

  2. Enable the service so it starts on boot:
       sudo systemctl enable --now gpu-agent

  3. Confirm it's heartbeating:
       sudo journalctl -u gpu-agent -f

EOF
