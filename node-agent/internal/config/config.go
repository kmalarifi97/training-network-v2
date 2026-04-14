// Package config handles reading and writing the agent config file.
//
// v1 uses JSON at ~/.gpu-agent/config.json in dev, /etc/gpu-agent/config.json
// in prod. JSON keeps the node-agent dependency-free; YAML can be swapped in
// later without changing the public API.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	ControlPlaneURL string `json:"control_plane_url"`
	NodeID          string `json:"node_id"`
	AgentToken      string `json:"agent_token,omitempty"`

	// Path is populated on Load and consumed by Save; it is never serialized.
	Path string `json:"-"`
}

// DefaultPath returns the standard config file location for the current user.
// Falls back to /etc/gpu-agent/config.json when the home directory is unknown.
func DefaultPath() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".gpu-agent", "config.json")
	}
	return "/etc/gpu-agent/config.json"
}

// Load reads the config file at path. Returns an error if the file is missing
// or malformed — callers should handle os.IsNotExist as "not yet initialized".
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	cfg.Path = path
	return &cfg, nil
}

// Save writes the config to disk, creating parent directories (0700) and the
// file (0600) if needed. Path must be set on the receiver.
func (c *Config) Save() error {
	if c.Path == "" {
		return errors.New("Config.Path is empty — set Path before calling Save")
	}
	if err := os.MkdirAll(filepath.Dir(c.Path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.Path, data, 0o600)
}
