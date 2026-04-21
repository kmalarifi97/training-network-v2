package cmd

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRequestDeviceCode_HappyPath(t *testing.T) {
	var gotBody createCodePayload
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/devices/code" || r.Method != http.MethodPost {
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &gotBody); err != nil {
			t.Fatalf("bad json: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{
			"code": "ABCD-EFGH",
			"polling_token": "gpudev_xyz",
			"verify_url": "http://ui/activate",
			"expires_at": "2030-01-01T00:00:00Z"
		}`))
	}))
	defer srv.Close()

	resp, err := requestDeviceCode(context.Background(), srv.URL, createCodePayload{
		GPUModel: "RTX 4090", GPUMemoryGB: 24, GPUCount: 1,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Code != "ABCD-EFGH" || resp.PollingToken != "gpudev_xyz" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if gotBody.GPUModel != "RTX 4090" || gotBody.GPUMemoryGB != 24 || gotBody.GPUCount != 1 {
		t.Fatalf("body mismatch: %+v", gotBody)
	}
}

func TestRequestDeviceCode_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"detail":"boom"}`, http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := requestDeviceCode(context.Background(), srv.URL, createCodePayload{
		GPUModel: "x", GPUMemoryGB: 1, GPUCount: 1,
	})
	if err == nil {
		t.Fatal("expected error from 500, got nil")
	}
}

func TestPollUntilApproved_PendingThenApproved(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if !strings.HasPrefix(r.URL.Path, "/api/devices/code/") {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if n < 3 {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"status":"pending"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"status":"approved",
			"node_id":"11111111-1111-1111-1111-111111111111",
			"node_name":"node-abc123",
			"agent_token":"gpuagent_secret",
			"control_plane_url":"http://example:8000"
		}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got, err := pollUntilApproved(ctx, srv.URL, "gpudev_xyz", 10*time.Millisecond)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.AgentToken != "gpuagent_secret" || got.NodeID == "" {
		t.Fatalf("bad approved response: %+v", got)
	}
	if calls.Load() < 3 {
		t.Fatalf("expected at least 3 polls, got %d", calls.Load())
	}
}

func TestPollUntilApproved_ExpiredIsTerminal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"detail":"Device code is invalid: expired","reason":"expired"}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_, err := pollUntilApproved(ctx, srv.URL, "gpudev_xyz", 5*time.Millisecond)
	if err == nil {
		t.Fatal("expected terminal error for expired code, got nil")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Fatalf("error should mention reason, got %v", err)
	}
}

func TestPollUntilApproved_ContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"status":"pending"}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	_, err := pollUntilApproved(ctx, srv.URL, "gpudev_xyz", 10*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected timeout error, got %v", err)
	}
}
