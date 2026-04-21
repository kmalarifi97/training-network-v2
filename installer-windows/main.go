// GPU Network host installer for Windows.
//
// One-file Go program, cross-compiled from macOS/Linux with
// GOOS=windows GOARCH=amd64 go build -o gpu-network-setup.exe
//
// What it does, in order:
//   1. Checks whether WSL2 + the Ubuntu distro are installed. If not, runs
//      `wsl --install -d Ubuntu`, registers itself in Windows RunOnce so
//      it auto-resumes after the reboot, and triggers the reboot.
//   2. Post-reboot (or first run on a machine that already had WSL), waits
//      for Ubuntu to respond, then streams `curl ... | sudo bash` of our
//      install.sh inside the Ubuntu distro.
//   3. Watches the agent's stdout/stderr for the device-code activation
//      prompt ("Visit <url>" + "Enter <CODE>"), parses both, and opens the
//      user's default browser at <verify_url>?code=<CODE> so the user just
//      clicks "Approve" to finish.
//
// Not a wizard — a console app that streams progress. Friends-beta only:
// not code-signed, so Windows SmartScreen will warn; users click through.

//go:build windows

package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
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
		// We're running post-reboot. Ubuntu's first-run wizard may still be
		// open; retry for up to 3 minutes before giving up.
		fmt.Println("Resuming after reboot. Waiting for Ubuntu to be ready...")
		if err := waitForUbuntu(3 * time.Minute); err != nil {
			bail("Ubuntu didn't become ready in time.\n" +
				"Finish Ubuntu's first-run setup (pick a username + password in the Ubuntu window),\n" +
				"then double-click this installer again.\n\n(technical: %v)", err)
		}
	}

	// Phase 2 — run install.sh inside Ubuntu and watch for the device code.
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

// ubuntuReady returns true only if `wsl -d Ubuntu` can actually execute a
// command. `wsl -l -q` can list "Ubuntu" while the distro is mid-install and
// not yet runnable, so we check end-to-end instead.
func ubuntuReady() (bool, error) {
	// Fast path: is Ubuntu even in the list?
	out, err := runCmd("wsl.exe", "-l", "-q")
	if err != nil {
		// `wsl -l` with no distros installed exits non-zero on some Win builds.
		return false, nil
	}
	// `wsl -l -q` writes UTF-16LE on older builds — normalise by stripping nulls.
	listing := strings.ToLower(strings.ReplaceAll(string(out), "\x00", ""))
	if !strings.Contains(listing, strings.ToLower(ubuntuDistro)) {
		return false, nil
	}
	// Deep path: can we actually run a command inside it?
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
	// --no-launch skips the GUI auto-popup so our console stays in focus;
	// Windows will still complete the install on reboot.
	cmd := exec.Command("wsl.exe", "--install", "-d", ubuntuDistro, "--no-launch")
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
   install.sh inside Ubuntu + device-code browser hand-off
   ----------------------------------------------------------------- */

var (
	reVisit = regexp.MustCompile(`Visit\s+(https?://\S+)`)
	reEnter = regexp.MustCompile(`Enter\s+([A-Z0-9]{4}-[A-Z0-9]{4})`)
)

func runInstallInWSL(controlPlane string) error {
	// Pipe `curl .../install.sh | sudo bash` through Ubuntu. The -E preserves
	// the sudo env; the final exec runs as root, which install.sh requires.
	script := fmt.Sprintf(
		"set -e; curl -fsSL %s/public/install.sh | sudo bash",
		strings.TrimRight(controlPlane, "/"),
	)
	cmd := exec.Command("wsl.exe", "-d", ubuntuDistro, "--", "bash", "-c", script)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	// Scan both streams concurrently. The agent's activation prompt goes to
	// stderr (see node-agent/cmd/login.go), but we scan both so we're robust
	// to output re-routing.
	var (
		mu          sync.Mutex
		code        string
		verifyURL   string
		opened      bool
		wg          sync.WaitGroup
	)
	scan := func(src io.Reader, tag string) {
		defer wg.Done()
		r := bufio.NewScanner(src)
		r.Buffer(make([]byte, 64*1024), 1024*1024)
		for r.Scan() {
			line := r.Text()
			fmt.Println(line)
			mu.Lock()
			if m := reVisit.FindStringSubmatch(line); m != nil && verifyURL == "" {
				verifyURL = m[1]
			}
			if m := reEnter.FindStringSubmatch(line); m != nil && code == "" {
				code = m[1]
			}
			if !opened && code != "" && verifyURL != "" {
				opened = true
				full := fmt.Sprintf("%s?code=%s", verifyURL, code)
				fmt.Println()
				fmt.Println("------------------------------------------------------------")
				fmt.Printf("  Opening approval page in your browser:\n    %s\n", full)
				fmt.Println("  Click 'Approve' there to finish setup.")
				fmt.Println("------------------------------------------------------------")
				fmt.Println()
				openBrowser(full)
			}
			mu.Unlock()
		}
		_ = tag
	}
	wg.Add(2)
	go scan(stdout, "stdout")
	go scan(stderr, "stderr")

	// Wait for install.sh to finish. It blocks on `gpu-agent login` until the
	// user approves in the browser; when they do, systemctl enable fires and
	// the process exits 0.
	waitErr := cmd.Wait()
	wg.Wait()

	if waitErr != nil {
		return waitErr
	}
	if code == "" || verifyURL == "" {
		return fmt.Errorf("install.sh finished but we never saw a device-code prompt — check output above")
	}
	return nil
}

func openBrowser(url string) {
	// rundll32 is the most reliable way to hand a URL to the Windows shell
	// from a non-interactive console. `start` works too but needs cmd.exe.
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
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
