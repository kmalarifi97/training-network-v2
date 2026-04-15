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
	"strings"
	"time"

	"gpu-network-v2/node-agent/internal/config"
	"gpu-network-v2/node-agent/internal/gpu"
)

// registerPayload mirrors RegisterNodeRequest on the control plane.
type registerPayload struct {
	ClaimToken    string `json:"claim_token"`
	GPUModel      string `json:"gpu_model"`
	GPUMemoryGB   int    `json:"gpu_memory_gb"`
	GPUCount      int    `json:"gpu_count"`
	SuggestedName string `json:"suggested_name,omitempty"`
}

type registerResponse struct {
	NodeID        string         `json:"node_id"`
	AgentToken    string         `json:"agent_token"`
	ConfigPayload map[string]any `json:"config_payload"`
}

func runInit(args []string) error {
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	controlPlane := fs.String("control-plane", "", "Control plane base URL (required)")
	claimToken := fs.String("claim-token", "", "One-time claim token from My Nodes (required)")
	nodeName := fs.String("name", "", "Optional suggested name for this node")
	configPath := fs.String("config", config.DefaultPath(), "Where to write the agent config file")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *controlPlane == "" || *claimToken == "" {
		return errors.New("both --control-plane and --claim-token are required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	devices, err := gpu.Detect(ctx, gpu.ExecRunner{})
	if err != nil {
		return fmt.Errorf("GPU detection failed: %w", err)
	}
	spec, err := gpu.Summarize(devices)
	if err != nil {
		return err
	}
	fmt.Printf("Detected %d GPU(s): %s, %d GB each\n", spec.Count, spec.Model, spec.MemoryGB)

	resp, err := registerNode(ctx, *controlPlane, registerPayload{
		ClaimToken:    *claimToken,
		GPUModel:      spec.Model,
		GPUMemoryGB:   spec.MemoryGB,
		GPUCount:      spec.Count,
		SuggestedName: *nodeName,
	})
	if err != nil {
		return fmt.Errorf("register node: %w", err)
	}

	cfg := &config.Config{
		ControlPlaneURL: *controlPlane,
		NodeID:          resp.NodeID,
		AgentToken:      resp.AgentToken,
		Path:            *configPath,
	}
	if err := cfg.Save(); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Printf("Node registered as %s\nConfig written to %s\n", resp.NodeID, *configPath)
	return nil
}

func registerNode(ctx context.Context, baseURL string, payload registerPayload) (*registerResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(baseURL, "/") + "/api/nodes/register"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("control plane returned %d: %s", resp.StatusCode, string(raw))
	}
	var out registerResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &out, nil
}
