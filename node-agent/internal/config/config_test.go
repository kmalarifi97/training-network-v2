package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveThenLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	original := &Config{
		ControlPlaneURL: "http://example.com",
		NodeID:          "node-123",
		Path:            path,
	}
	if err := original.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.ControlPlaneURL != original.ControlPlaneURL {
		t.Errorf("url mismatch: got %q want %q", loaded.ControlPlaneURL, original.ControlPlaneURL)
	}
	if loaded.NodeID != original.NodeID {
		t.Errorf("node id mismatch: got %q want %q", loaded.NodeID, original.NodeID)
	}
	if loaded.Path != path {
		t.Errorf("path not populated on Load: %q", loaded.Path)
	}
}

func TestLoad_MissingFile(t *testing.T) {
	_, err := Load("/definitely/not/a/real/path/config.json")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
	if !os.IsNotExist(err) {
		t.Fatalf("expected IsNotExist, got %v", err)
	}
}

func TestSave_RequiresPath(t *testing.T) {
	cfg := &Config{ControlPlaneURL: "http://x"}
	if err := cfg.Save(); err == nil {
		t.Fatal("expected error when Path is empty, got nil")
	}
}

func TestDefaultPath(t *testing.T) {
	p := DefaultPath()
	if p == "" {
		t.Fatal("DefaultPath returned empty string")
	}
}
