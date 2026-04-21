#!/usr/bin/env bash
# Cross-compile gpu-network-setup.exe from macOS/Linux to windows/amd64,
# and drop the result at control-plane/public/gpu-network-setup.exe so the
# running control plane serves it at /public/gpu-network-setup.exe.
#
# One-time setup on this machine:
#   go install github.com/akavel/rsrc@latest
#   (adds ~/go/bin/rsrc, which embeds the UAC manifest into the Go binary.)

set -euo pipefail

cd "$(dirname "$0")"

OUT_DIR="../control-plane/public"
OUT_EXE="gpu-network-setup.exe"

# 1. Compile manifest.xml → rsrc.syso so `go build` picks it up automatically.
if ! command -v rsrc >/dev/null 2>&1; then
    echo "rsrc not on PATH. Install once with:"
    echo "  go install github.com/akavel/rsrc@latest"
    echo "and make sure \$(go env GOPATH)/bin is on your PATH."
    exit 1
fi

rsrc -manifest manifest.xml -arch amd64 -o rsrc.syso
echo "==> embedded UAC manifest into rsrc.syso"

# 2. Cross-compile to windows/amd64. -s -w strips debug info for a smaller exe.
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w" -o "${OUT_EXE}" .
echo "==> built ${OUT_EXE} ($(stat -f %z "${OUT_EXE}" 2>/dev/null || stat -c %s "${OUT_EXE}") bytes)"

# 3. Publish to the control-plane static dir.
mkdir -p "${OUT_DIR}"
mv "${OUT_EXE}" "${OUT_DIR}/${OUT_EXE}"
echo "==> published to ${OUT_DIR}/${OUT_EXE}"
echo
echo "Running control planes will serve it at  /public/${OUT_EXE}"
