// GPU Network host installer for Windows.
//
// One-file Go program, cross-compiled from macOS/Linux with
// GOOS=windows GOARCH=amd64 go build -o gpu-network-setup.exe
//
// What it does, in order:
//   1. Checks whether WSL2 + the Ubuntu distro are installed. If not,
//      runs `wsl --install`, registers itself in Windows RunOnce so it
//      auto-resumes after the reboot, and triggers the reboot.
//   2. Post-reboot (or first run on a machine that already had WSL),
//      ensures Ubuntu is registered (installing via `wsl --install -d
//      Ubuntu --no-launch` if needed) and waits until it responds.
//   3. Queries nvidia-smi.exe on the Windows side for GPU info, POSTs
//      to /api/devices/code to mint a device code, opens the user's
//      browser at <verify_url>?code=<CODE>, then streams `curl ... |
//      sudo -E bash` of our install.sh inside Ubuntu with the polling
//      token in the environment. install.sh forwards the token to
//      `gpu-agent login --polling-token=...`, which skips its own code
//      creation and just polls — so the only user interaction is the
//      single "Approve" click in the browser.
//
// Not a wizard — a console app that streams progress. Friends-beta only:
// not code-signed, so Windows SmartScreen will warn; users click through.

//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
)

const (
	defaultControlPlane = "http://34.18.164.66:8000"
	ubuntuDistro        = "Ubuntu"
	runOnceKey          = `Software\Microsoft\Windows\CurrentVersion\RunOnce`
	runOnceValue        = "GPUNetworkSetup"
	banner              = `
============================================================
              GPU Network — Windows installer
============================================================
`
)

func main() {
	var (
		resume       = flag.Bool("resume", false, "Internal: set by RunOnce after the reboot. Skip the WSL-install step and go straight to running install.sh.")
		controlPlane = flag.String("control-plane", defaultControlPlane, "Control plane base URL to install against.")
		skipReboot   = flag.Bool("skip-reboot", false, "Install WSL but don't reboot automatically — for testing.")
	)
	flag.Parse()

	fmt.Print(banner)
	fmt.Println()

	// Phase 1 — make sure WSL + Ubuntu are reachable.
	if !*resume {
		ready, err := ubuntuReady()
		if err != nil {
			bail("couldn't query WSL: %v", err)
		}
		if !ready {
			fmt.Println("WSL (Ubuntu) is not installed on this machine.")
			fmt.Println("I'll install it now. Windows will reboot, then this installer will resume itself automatically.")
			fmt.Println()
			if !confirm("Continue? [y/N]: ") {
				pauseAndExit(0, "Cancelled.")
			}

			if err := installWSL(); err != nil {
				bail("failed to install WSL: %v", err)
			}
			if err := setRunOnce(); err != nil {
				bail("couldn't register post-reboot resume: %v", err)
			}

			if *skipReboot {
				fmt.Println("\nWSL scheduled. Reboot skipped (--skip-reboot). Re-run this exe after you reboot.")
				pauseAndExit(0, "")
			}
			fmt.Println("\nWSL scheduled. Rebooting in 15 seconds — save your work.")
			fmt.Println("After reboot, Ubuntu may ask you to pick a username + password.")
			fmt.Println("Once that's done, this installer will resume automatically.")
			time.Sleep(15 * time.Second)
			_ = exec.Command("shutdown", "/r", "/t", "0").Run()
			return
		}
	} else {
		// We're running post-reboot. The Store-delivered wsl.exe is live
		// now, so if the phase-1 bootstrap didn't register Ubuntu we can
		// do it ourselves — `-d Ubuntu --no-launch` is accepted at this
		// point. Ubuntu's first-run wizard may still be open afterwards;
		// waitForUbuntu retries until it responds.
		fmt.Println("Resuming after reboot. Checking WSL state...")
		if !ubuntuRegistered() {
			fmt.Println("Ubuntu isn't registered yet — installing it now.")
			cmd := exec.Command("wsl.exe", "--install", "-d", ubuntuDistro, "--no-launch")
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				bail("failed to install Ubuntu: %v", err)
			}
		}
		fmt.Println("Waiting for Ubuntu to be ready...")
		if err := waitForUbuntu(5 * time.Minute); err != nil {
			bail("Ubuntu didn't become ready in time.\n" +
				"Finish Ubuntu's first-run setup (pick a username + password in the Ubuntu window),\n" +
				"then double-click this installer again.\n\n(technical: %v)", err)
		}
	}

	// Phase 2 — mint a device code on the Windows side, open the approval
	// page, and run install.sh inside Ubuntu with the polling token.
	fmt.Println("Ubuntu is ready. Running the GPU Network installer inside Ubuntu.")
	fmt.Println("This takes 3–5 minutes (Docker + NVIDIA toolkit + agent download).")
	fmt.Println()

	if err := runInstallInWSL(*controlPlane); err != nil {
		bail("install failed: %v", err)
	}

	// If we got here, install.sh exited cleanly — the agent is registered
	// and running as a systemd unit inside WSL.
	fmt.Println()
	fmt.Println("============================================================")
	fmt.Println("  Done. Your GPU is now part of the network.")
	fmt.Println("============================================================")
	pauseAndExit(0, "")
}

/* -----------------------------------------------------------------
   WSL detection + install
   ----------------------------------------------------------------- */

// ubuntuRegistered returns true if Ubuntu appears in `wsl -l -q`, meaning
// the distro has been at least registered — even if it isn't runnable yet.
func ubuntuRegistered() bool {
	out, err := runCmd("wsl.exe", "-l", "-q")
	if err != nil {
		// `wsl -l` with no distros installed exits non-zero on some Win builds.
		return false
	}
	// `wsl -l -q` writes UTF-16LE on older builds — normalise by stripping nulls.
	listing := strings.ToLower(strings.ReplaceAll(string(out), "\x00", ""))
	return strings.Contains(listing, strings.ToLower(ubuntuDistro))
}

// ubuntuReady returns true only if `wsl -d Ubuntu` can actually execute a
// command. `wsl -l -q` can list "Ubuntu" while the distro is mid-install and
// not yet runnable, so we check end-to-end instead.
func ubuntuReady() (bool, error) {
	if !ubuntuRegistered() {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "wsl.exe", "-d", ubuntuDistro, "--", "true")
	return cmd.Run() == nil, nil
}

func waitForUbuntu(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		ready, _ := ubuntuReady()
		if ready {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out after %s", timeout)
		}
		fmt.Print(".")
		time.Sleep(10 * time.Second)
	}
}

func installWSL() error {
	// On a pristine machine the inbox wsl.exe stub at C:\Windows\System32
	// only accepts bare `--install`: it downloads the WSL MSIX and enables
	// VirtualMachinePlatform, then requires a reboot. Passing `-d Ubuntu
	// --no-launch` alongside `--install` is rejected by the stub and falls
	// back to a misleading "WSL is not installed" error. The distro install
	// happens on the resume pass, once the Store-delivered wsl.exe is live.
	cmd := exec.Command("wsl.exe", "--install")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func setRunOnce() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("couldn't resolve own path: %w", err)
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runOnceKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	// Quote the exe path in case it has spaces (e.g. Downloads\GPU Network\…).
	return k.SetStringValue(runOnceValue, fmt.Sprintf(`"%s" --resume`, exe))
}

/* -----------------------------------------------------------------
   Device-code minting + install.sh inside Ubuntu
   ----------------------------------------------------------------- */

// gpuSpec mirrors the fields the control plane's /api/devices/code
// endpoint expects. Populated on the Windows side via nvidia-smi.exe so
// the approval page can show the user exactly which machine they're
// about to add before Ubuntu has even finished its first-run setup.
type gpuSpec struct {
	Model    string
	MemoryGB int
	Count    int
}

type createCodePayload struct {
	GPUModel    string `json:"gpu_model"`
	GPUMemoryGB int    `json:"gpu_memory_gb"`
	GPUCount    int    `json:"gpu_count"`
}

type createCodeResponse struct {
	Code         string `json:"code"`
	PollingToken string `json:"polling_token"`
	VerifyURL    string `json:"verify_url"`
	ExpiresAt    string `json:"expires_at"`
}

// detectGPUWindows shells out to nvidia-smi.exe on the Windows host.
// The NVIDIA driver that makes WSL's /usr/lib/wsl/lib/nvidia-smi work
// also installs nvidia-smi.exe in System32, so we can inspect the GPU
// before WSL is ready. Errors are returned verbatim; callers treat a
// missing/failing nvidia-smi as best-effort and fall through with an
// empty spec — the agent re-detects inside WSL anyway.
func detectGPUWindows(ctx context.Context) (*gpuSpec, error) {
	out, err := exec.CommandContext(ctx, "nvidia-smi.exe",
		"--query-gpu=name,memory.total",
		"--format=csv,noheader,nounits",
	).Output()
	if err != nil {
		return nil, err
	}
	type dev struct {
		Model    string
		MemoryMB int
	}
	var devices []dev
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ",", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("unexpected nvidia-smi output: %q", line)
		}
		mem, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("parse memory %q: %w", parts[1], err)
		}
		devices = append(devices, dev{Model: strings.TrimSpace(parts[0]), MemoryMB: mem})
	}
	if len(devices) == 0 {
		return nil, fmt.Errorf("nvidia-smi reported no GPUs")
	}
	// Match node-agent/internal/gpu.Summarize: first device's model +
	// memory with the total count. Integer division on MemoryMB/1024
	// produces the same GB rounding the agent would.
	memGB := devices[0].MemoryMB / 1024
	if memGB < 1 {
		memGB = 1
	}
	return &gpuSpec{
		Model:    devices[0].Model,
		MemoryGB: memGB,
		Count:    len(devices),
	}, nil
}

// createDeviceCode asks the control plane to mint a device code bound
// to the given GPU spec. We create it here (rather than letting the
// agent do it inside WSL) so we know the code + polling_token up-front
// and can open the approval page the instant install.sh starts.
func createDeviceCode(ctx context.Context, controlPlane string, spec *gpuSpec) (*createCodeResponse, error) {
	payload := createCodePayload{}
	if spec != nil {
		payload.GPUModel = spec.Model
		payload.GPUMemoryGB = spec.MemoryGB
		payload.GPUCount = spec.Count
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(controlPlane, "/") + "/api/devices/code"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("control plane returned %d: %s", resp.StatusCode, string(raw))
	}
	var out createCodeResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &out, nil
}

func openBrowser(url string) {
	// rundll32 is the most reliable way to hand a URL to the Windows
	// shell from a non-interactive console. `start` works too but
	// needs cmd.exe.
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// shellQuote wraps s in single quotes and escapes embedded single
// quotes the bash-standard way, so arbitrary values (like an API
// token) can be safely embedded in a `bash -c "…"` script.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func runInstallInWSL(controlPlane string) error {
	// 1. Probe GPU on the Windows side (best-effort). The approval page
	//    uses this to show "NVIDIA RTX 5060 Ti, 8 GB" before the user
	//    clicks Approve.
	detectCtx, cancelDetect := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelDetect()
	spec, err := detectGPUWindows(detectCtx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "note: nvidia-smi.exe probe failed (%v). Continuing without GPU info — the approval page will show placeholder values.\n", err)
		spec = nil
	} else {
		fmt.Printf("Detected %d GPU(s): %s, %d GB each\n", spec.Count, spec.Model, spec.MemoryGB)
	}

	// 2. Mint the device code ourselves — no scraping, no race.
	apiCtx, cancelAPI := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelAPI()
	code, err := createDeviceCode(apiCtx, controlPlane, spec)
	if err != nil {
		return fmt.Errorf("create device code: %w", err)
	}

	// 3. Open the approval page immediately.
	approvalURL := fmt.Sprintf("%s?code=%s", code.VerifyURL, code.Code)
	fmt.Println()
	fmt.Println("------------------------------------------------------------")
	fmt.Printf("  Opening approval page in your browser:\n    %s\n", approvalURL)
	fmt.Println("  Click 'Approve' there to finish setup.")
	fmt.Println("------------------------------------------------------------")
	fmt.Println()
	openBrowser(approvalURL)

	// 4. Run install.sh inside Ubuntu with the polling token in the
	//    environment. install.sh forwards it to `gpu-agent login
	//    --polling-token=...` which skips its own code creation and
	//    just polls — so the single Approve click is all that's left.
	script := fmt.Sprintf(
		`set -e; export GPU_AGENT_POLLING_TOKEN=%s; curl -fsSL %s/public/install.sh | sudo -E bash`,
		shellQuote(code.PollingToken),
		strings.TrimRight(controlPlane, "/"),
	)
	cmd := exec.Command("wsl.exe", "-d", ubuntuDistro, "--", "bash", "-c", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

/* -----------------------------------------------------------------
   Console helpers
   ----------------------------------------------------------------- */

func runCmd(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Output()
}

func confirm(prompt string) bool {
	fmt.Print(prompt)
	reader := bufio.NewReader(os.Stdin)
	line, _ := reader.ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))
	return line == "y" || line == "yes"
}

func bail(format string, args ...any) {
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "ERROR:")
	fmt.Fprintf(os.Stderr, "  "+format+"\n", args...)
	pauseAndExit(1, "")
}

func pauseAndExit(code int, msg string) {
	if msg != "" {
		fmt.Println(msg)
	}
	fmt.Println()
	fmt.Println("Press Enter to close this window...")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	os.Exit(code)
}
