package gpu

import (
	"context"
	"errors"
	"testing"
)

type stubRunner struct {
	out []byte
	err error
}

func (s stubRunner) Run(_ context.Context, _ string, _ ...string) ([]byte, error) {
	return s.out, s.err
}

func TestDetect_ParsesTwoHomogeneousGPUs(t *testing.T) {
	out := []byte("NVIDIA GeForce RTX 4090, 24576\nNVIDIA GeForce RTX 4090, 24576\n")
	devices, err := Detect(context.Background(), stubRunner{out: out})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devices))
	}
	if devices[0].Model != "NVIDIA GeForce RTX 4090" {
		t.Errorf("unexpected model: %q", devices[0].Model)
	}
	if devices[0].MemoryMB != 24576 {
		t.Errorf("unexpected memory: %d", devices[0].MemoryMB)
	}
}

func TestDetect_SingleGPU(t *testing.T) {
	out := []byte("Tesla T4, 15360\n")
	devices, err := Detect(context.Background(), stubRunner{out: out})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
}

func TestDetect_NvidiaSmiMissing(t *testing.T) {
	_, err := Detect(context.Background(), stubRunner{err: ErrNvidiaSmiMissing})
	if !errors.Is(err, ErrNvidiaSmiMissing) {
		t.Fatalf("expected ErrNvidiaSmiMissing, got %v", err)
	}
}

func TestDetect_MalformedLine(t *testing.T) {
	out := []byte("bad line with only one field\n")
	_, err := Detect(context.Background(), stubRunner{out: out})
	if err == nil {
		t.Fatal("expected parse error, got nil")
	}
}

func TestSummarize_TwoHomogeneousGPUs(t *testing.T) {
	devices := []Device{
		{Model: "NVIDIA A100", MemoryMB: 81920},
		{Model: "NVIDIA A100", MemoryMB: 81920},
	}
	spec, err := Summarize(devices)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if spec.Count != 2 {
		t.Errorf("expected count 2, got %d", spec.Count)
	}
	if spec.MemoryGB != 80 {
		t.Errorf("expected 80GB, got %d", spec.MemoryGB)
	}
	if spec.Model != "NVIDIA A100" {
		t.Errorf("unexpected model: %q", spec.Model)
	}
}

func TestSummarize_Empty(t *testing.T) {
	_, err := Summarize(nil)
	if err == nil {
		t.Fatal("expected error on empty GPU list, got nil")
	}
}
