# installer-windows

Single-binary Windows installer (`gpu-network-setup.exe`). Hides the WSL2 +
Docker + NVIDIA + agent setup behind a console app that reboots once and
finishes itself.

## What it does

On a pristine Windows 11 machine:

1. Check `wsl -l` for an Ubuntu distro.
2. If missing, run `wsl --install -d Ubuntu --no-launch`, register itself in
   `HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce`, reboot.
3. On first Windows login after reboot, RunOnce fires this exe again with
   `--resume`. Waits for Ubuntu (first-run wizard might still be open),
   then runs our `install.sh` inside Ubuntu.
4. Scans the agent's activation prompt, extracts the device code, and opens
   the user's browser at `<ui>/activate?code=XXXX-XXXX` automatically.

On a machine that already has WSL2 + Ubuntu, steps 1–3 skip to "run
install.sh inside Ubuntu" and there's no reboot.

The installer is **not** code-signed. Windows SmartScreen will warn on
first launch; users click "More info" → "Run anyway". Friends-beta only —
revisit once stranger signups start (cheapest path then is Microsoft
Trusted Signing at ~$10/month).

## Build

One-time, on this machine:

```bash
go install github.com/akavel/rsrc@latest
```

Then whenever you need a fresh exe:

```bash
./build.sh
```

That cross-compiles to `windows/amd64`, embeds the UAC manifest from
`manifest.xml` via `rsrc.syso`, and drops the binary at
`control-plane/public/gpu-network-setup.exe` so the running control
plane serves it at `GET /public/gpu-network-setup.exe`.

## Flags (mostly internal)

| Flag | Use |
|---|---|
| `--resume` | Set automatically by RunOnce after the reboot. Skips the "is WSL installed?" check and waits for Ubuntu to become ready. Don't pass this yourself. |
| `--control-plane=<url>` | Point at a non-default control plane (default: `http://34.18.164.66:8000`). Handy for testing against a local stack. |
| `--skip-reboot` | Install WSL but don't auto-reboot — useful for manual test runs. |

## Testing without a Windows machine

You can't actually run the exe on macOS/Linux. The build is
cross-platform, but the runtime uses `wsl.exe`, `shutdown`, and the
Windows registry, so every path must be exercised on an actual Windows
host. Run the `build.sh` output against a friend's Windows 11 box and
watch the console.
