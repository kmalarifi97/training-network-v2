package agent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gpu-network-v2/node-agent/internal/config"
)

type stubHTTP struct {
	mu        atomic.Int32
	heartbeat atomic.Int32
	claim     atomic.Int32
	complete  atomic.Int32

	claimResp *http.Response
}

func (s *stubHTTP) Do(req *http.Request) (*http.Response, error) {
	s.mu.Add(1)
	switch {
	case strings.HasSuffix(req.URL.Path, "/heartbeat"):
		s.heartbeat.Add(1)
		body := `{"received_at":"2026-04-15T18:00:00Z","cancel_job_id":null}`
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     http.Header{},
		}, nil
	case strings.HasSuffix(req.URL.Path, "/api/jobs/claim"):
		s.claim.Add(1)
		if s.claimResp != nil {
			return s.claimResp, nil
		}
		return &http.Response{StatusCode: 204, Body: io.NopCloser(strings.NewReader(""))}, nil
	case strings.HasSuffix(req.URL.Path, "/complete"):
		s.complete.Add(1)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}"))}, nil
}

type stubRunner struct {
	exitCode int
	err      error
	called   atomic.Int32
}

func (r *stubRunner) Run(_ context.Context, _ string, _ []string) (int, error) {
	r.called.Add(1)
	return r.exitCode, r.err
}

func TestDaemon_HeartbeatsAndClaimsThenStops(t *testing.T) {
	stub := &stubHTTP{}
	runner := &stubRunner{}
	d := &Daemon{
		cfg: &config.Config{
			ControlPlaneURL: "http://example.com",
			NodeID:          "n1",
			AgentToken:      "gpuagent_xxx",
		},
		httpClient: stub,
		runner:     runner,
		interval:   10 * time.Millisecond,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	_ = d.Run(ctx)

	if stub.heartbeat.Load() < 2 {
		t.Errorf("expected multiple heartbeats, got %d", stub.heartbeat.Load())
	}
	if stub.claim.Load() < 1 {
		t.Errorf("expected at least one claim attempt, got %d", stub.claim.Load())
	}
}

func TestDaemon_RunsClaimedJobAndReportsComplete(t *testing.T) {
	assignment := JobAssignment{
		JobID:              "job-abc",
		DockerImage:        "ubuntu:latest",
		Command:            []string{"echo", "hi"},
		MaxDurationSeconds: 5,
	}
	body, _ := json.Marshal(assignment)
	stub := &stubHTTP{
		claimResp: &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(string(body))),
		},
	}
	runner := &stubRunner{exitCode: 0}

	d := &Daemon{
		cfg: &config.Config{
			ControlPlaneURL: "http://example.com",
			NodeID:          "n1",
			AgentToken:      "gpuagent_xxx",
		},
		httpClient: stub,
		runner:     runner,
		interval:   10 * time.Millisecond,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_ = d.Run(ctx)

	if runner.called.Load() < 1 {
		t.Fatal("runner was never called for the claimed job")
	}
	if stub.complete.Load() < 1 {
		t.Fatal("complete was never reported")
	}
}
