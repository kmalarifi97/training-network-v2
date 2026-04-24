package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"gpu-network-v2/node-agent/internal/config"
	"gpu-network-v2/node-agent/internal/gpu"
)

// Device-code onboarding: the host runs `gpu-agent login`, gets a short
// code + verify_url printed to the terminal, and polls the control plane
// until the user approves the code in a browser. No claim-token paste.

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

type pollApprovedResponse struct {
	Status          string `json:"status"`
	NodeID          string `json:"node_id"`
	NodeName        string `json:"node_name"`
	AgentToken      string `json:"agent_token"`
	ControlPlaneURL string `json:"control_plane_url"`
}

type pollErrorBody struct {
	Detail string `json:"detail"`
	Reason string `json:"reason"`
}

func runLogin(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	controlPlane := fs.String("control-plane", "", "Control plane base URL (required)")
	configPath := fs.String("config", config.DefaultPath(), "Where to write the agent config file")
	pollingTokenFlag := fs.String("polling-token", "", "Pre-created polling token from a wrapper installer. When set, skips GPU detect + code creation + the activation banner and polls the given token directly.")
	pollEveryFlag := fs.Duration("poll-interval", 3*time.Second, "How often to poll while waiting for approval")
	timeoutFlag := fs.Duration("timeout", 10*time.Minute, "Stop waiting for approval after this duration")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *controlPlane == "" {
		return errors.New("--control-plane is required")
	}
	baseURL := strings.TrimRight(*controlPlane, "/")

	var pollingToken string
	if *pollingTokenFlag != "" {
		// Wrapper installer (e.g. gpu-network-setup.exe) already created the
		// device code and opened the browser — we just poll.
		pollingToken = *pollingTokenFlag
		fmt.Fprintln(os.Stderr, "Using device code from installer. Waiting for approval in your browser...")
	} else {
		detectCtx, cancelDetect := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancelDetect()
		devices, err := gpu.Detect(detectCtx, gpu.ExecRunner{})
		if err != nil {
			return fmt.Errorf("GPU detection failed: %w", err)
		}
		spec, err := gpu.Summarize(devices)
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "Detected %d GPU(s): %s, %d GB each\n", spec.Count, spec.Model, spec.MemoryGB)

		code, err := requestDeviceCode(detectCtx, baseURL, createCodePayload{
			GPUModel:    spec.Model,
			GPUMemoryGB: spec.MemoryGB,
			GPUCount:    spec.Count,
		})
		if err != nil {
			return fmt.Errorf("request device code: %w", err)
		}

		printActivationPrompt(code)
		pollingToken = code.PollingToken
	}

	pollCtx, cancelPoll := context.WithTimeout(context.Background(), *timeoutFlag)
	defer cancelPoll()

	approved, err := pollUntilApproved(pollCtx, baseURL, pollingToken, *pollEveryFlag)
	if err != nil {
		return err
	}

	// The server-advertised control plane URL is canonical; fall back to the
	// flag if it's empty (shouldn't happen in practice).
	effectiveCP := strings.TrimRight(approved.ControlPlaneURL, "/")
	if effectiveCP == "" {
		effectiveCP = baseURL
	}

	cfg := &config.Config{
		ControlPlaneURL: effectiveCP,
		NodeID:          approved.NodeID,
		AgentToken:      approved.AgentToken,
		Path:            *configPath,
	}
	if err := cfg.Save(); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Fprintf(os.Stderr, "\nApproved — node %s registered as %q\nConfig written to %s\n",
		approved.NodeID, approved.NodeName, *configPath)
	return nil
}

func requestDeviceCode(ctx context.Context, baseURL string, payload createCodePayload) (*createCodeResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		baseURL+"/api/devices/code", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
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
		return nil, fmt.Errorf("decode create-code response: %w", err)
	}
	return &out, nil
}

func pollUntilApproved(ctx context.Context, baseURL, pollingToken string, every time.Duration) (*pollApprovedResponse, error) {
	url := fmt.Sprintf("%s/api/devices/code/%s", baseURL, pollingToken)
	client := &http.Client{Timeout: 15 * time.Second}
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			// Transient network errors: keep trying until timeout.
			if ctx.Err() != nil {
				return nil, fmt.Errorf("timed out waiting for approval: %w", ctx.Err())
			}
			fmt.Fprintf(os.Stderr, "\npoll failed (retrying): %v\n", err)
		} else {
			result, done, err := interpretPoll(resp)
			if err != nil {
				return nil, err
			}
			if done {
				fmt.Fprintln(os.Stderr)
				return result, nil
			}
		}

		// Pending — tick a dot and wait for the next interval.
		fmt.Fprint(os.Stderr, ".")
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timed out waiting for approval (after %s)", every)
		case <-ticker.C:
		}
	}
}

// interpretPoll reads one poll response. Returns (result, done, err):
//   - done=false, err=nil → keep polling (202 pending or transient)
//   - done=true, err=nil  → approved; result is populated
//   - err!=nil            → terminal error (expired, already consumed, etc.)
func interpretPoll(resp *http.Response) (*pollApprovedResponse, bool, error) {
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	switch resp.StatusCode {
	case http.StatusOK:
		var out pollApprovedResponse
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, false, fmt.Errorf("decode poll response: %w", err)
		}
		if out.AgentToken == "" {
			return nil, false, errors.New("server returned 200 without agent_token")
		}
		return &out, true, nil

	case http.StatusAccepted:
		// Still waiting for the user to approve — normal.
		return nil, false, nil

	case http.StatusBadRequest:
		var body pollErrorBody
		_ = json.Unmarshal(raw, &body)
		return nil, false, fmt.Errorf("device code %s (%s)", body.Reason, body.Detail)

	default:
		return nil, false, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(raw))
	}
}

func printActivationPrompt(c *createCodeResponse) {
	bar := strings.Repeat("─", 52)
	fmt.Fprintf(os.Stderr, "\n%s\n", bar)
	fmt.Fprintf(os.Stderr, "  Visit  %s\n", c.VerifyURL)
	fmt.Fprintf(os.Stderr, "  Enter  %s\n", c.Code)
	fmt.Fprintf(os.Stderr, "%s\n", bar)
	fmt.Fprintln(os.Stderr, "\nWaiting for approval in your browser...")
}
