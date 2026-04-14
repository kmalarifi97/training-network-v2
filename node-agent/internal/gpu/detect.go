// Package gpu wraps nvidia-smi to enumerate GPUs on the host.
package gpu

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// ErrNvidiaSmiMissing is returned when the nvidia-smi binary is not installed.
var ErrNvidiaSmiMissing = errors.New("nvidia-smi not found on PATH; install NVIDIA drivers")

// Device describes a single GPU as reported by nvidia-smi.
type Device struct {
	Model    string
	MemoryMB int
}

// CommandRunner abstracts the one shell-out the detector makes, so tests can
// inject a canned response or an error without invoking a real binary.
type CommandRunner interface {
	Run(ctx context.Context, name string, args ...string) ([]byte, error)
}

// ExecRunner is the production implementation that shells out via os/exec.
type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	if _, err := exec.LookPath(name); err != nil {
		return nil, ErrNvidiaSmiMissing
	}
	cmd := exec.CommandContext(ctx, name, args...)
	return cmd.Output()
}

// Detect enumerates local GPUs by shelling out to nvidia-smi and parsing the
// CSV output. Returns an empty slice only if nvidia-smi reports zero GPUs.
func Detect(ctx context.Context, runner CommandRunner) ([]Device, error) {
	out, err := runner.Run(ctx, "nvidia-smi",
		"--query-gpu=name,memory.total",
		"--format=csv,noheader,nounits",
	)
	if err != nil {
		return nil, err
	}
	return parseCSV(string(out))
}

// GPUSpec is the single-row summary sent to the control plane's register
// endpoint. When GPUs on a host are heterogeneous, the first device's model
// and memory are reported with the total count.
type GPUSpec struct {
	Model    string
	MemoryGB int
	Count    int
}

// Summarize reduces a []Device into a single GPUSpec for node registration.
func Summarize(devices []Device) (GPUSpec, error) {
	if len(devices) == 0 {
		return GPUSpec{}, errors.New("no GPUs detected")
	}
	first := devices[0]
	memGB := first.MemoryMB / 1024
	if memGB < 1 {
		memGB = 1
	}
	return GPUSpec{
		Model:    first.Model,
		MemoryGB: memGB,
		Count:    len(devices),
	}, nil
}

func parseCSV(raw string) ([]Device, error) {
	var devices []Device
	for i, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) != 2 {
			return nil, fmt.Errorf("line %d: expected 2 CSV fields, got %d: %q", i+1, len(parts), line)
		}
		model := strings.TrimSpace(parts[0])
		memStr := strings.TrimSpace(parts[1])
		mem, err := strconv.Atoi(memStr)
		if err != nil {
			return nil, fmt.Errorf("line %d: memory field %q is not an integer: %w", i+1, memStr, err)
		}
		devices = append(devices, Device{Model: model, MemoryMB: mem})
	}
	return devices, nil
}
