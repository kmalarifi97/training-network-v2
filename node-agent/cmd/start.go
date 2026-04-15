package cmd

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os/signal"
	"syscall"

	"gpu-network-v2/node-agent/internal/agent"
	"gpu-network-v2/node-agent/internal/config"
)

func runStart(args []string) error {
	fs := flag.NewFlagSet("start", flag.ContinueOnError)
	configPath := fs.String("config", config.DefaultPath(), "Agent config file")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		return fmt.Errorf("load config: %w (run 'gpu-agent init' first)", err)
	}
	if cfg.AgentToken == "" {
		return errors.New("agent_token missing in config; re-run 'gpu-agent init'")
	}
	if cfg.ControlPlaneURL == "" || cfg.NodeID == "" {
		return errors.New("control_plane_url or node_id missing in config")
	}

	ctx, cancel := signal.NotifyContext(
		context.Background(), syscall.SIGINT, syscall.SIGTERM,
	)
	defer cancel()

	fmt.Printf("gpu-agent starting (node %s, control plane %s)\n",
		cfg.NodeID, cfg.ControlPlaneURL)
	d := agent.New(cfg)
	if err := d.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	fmt.Println("gpu-agent exiting cleanly")
	return nil
}
