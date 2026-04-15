// Package agent contains the worker daemon's polling loop. The daemon
// heartbeats the control plane on a fixed cadence, claims queued jobs when
// idle, runs them via the configured ContainerRunner, and reports completion.
package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"gpu-network-v2/node-agent/internal/config"
)

// DefaultTickInterval is the heartbeat / claim cadence.
const DefaultTickInterval = 10 * time.Second

// HTTPClient is satisfied by *http.Client. Stubbed in tests.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// ContainerRunner abstracts the docker invocation so tests can drive job
// completion without invoking a real daemon.
type ContainerRunner interface {
	Run(ctx context.Context, image string, command []string) (exitCode int, err error)
}

// JobAssignment mirrors the control plane's response from POST /api/jobs/claim.
type JobAssignment struct {
	JobID              string   `json:"job_id"`
	DockerImage        string   `json:"docker_image"`
	Command            []string `json:"command"`
	MaxDurationSeconds int      `json:"max_duration_seconds"`
}

type heartbeatResp struct {
	ReceivedAt  string  `json:"received_at"`
	CancelJobID *string `json:"cancel_job_id"`
}

// Daemon owns the lifecycle of a single agent process.
type Daemon struct {
	cfg        *config.Config
	httpClient HTTPClient
	runner     ContainerRunner
	interval   time.Duration

	mu        sync.Mutex
	runningID string
	cancelRun context.CancelFunc
}

// New returns a Daemon wired to the production HTTP and Docker implementations.
func New(cfg *config.Config) *Daemon {
	return &Daemon{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		runner:     DockerRunner{},
		interval:   DefaultTickInterval,
	}
}

// SetInterval overrides the tick cadence; useful in tests.
func (d *Daemon) SetInterval(i time.Duration) { d.interval = i }

// SetHTTPClient overrides the HTTP client; useful in tests.
func (d *Daemon) SetHTTPClient(c HTTPClient) { d.httpClient = c }

// SetRunner overrides the container runner; useful in tests.
func (d *Daemon) SetRunner(r ContainerRunner) { d.runner = r }

// Run blocks until ctx is cancelled. Errors per tick are logged; only ctx
// errors return.
func (d *Daemon) Run(ctx context.Context) error {
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()

	d.tickOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			d.tickOnce(ctx)
		}
	}
}

func (d *Daemon) tickOnce(ctx context.Context) {
	hb, err := d.heartbeat(ctx)
	if err != nil {
		log.Printf("heartbeat: %v", err)
		return
	}

	d.mu.Lock()
	busy := d.runningID != ""
	cancelTarget := ""
	if hb != nil && hb.CancelJobID != nil {
		cancelTarget = *hb.CancelJobID
	}
	cancel := d.cancelRun
	d.mu.Unlock()

	if busy {
		if cancelTarget != "" && cancel != nil {
			log.Printf("control plane requested cancel of job %s", cancelTarget)
			cancel()
		}
		return
	}

	job, err := d.claim(ctx)
	if err != nil {
		log.Printf("claim: %v", err)
		return
	}
	if job == nil {
		return
	}
	go d.runJob(ctx, job)
}

func (d *Daemon) runJob(parent context.Context, job *JobAssignment) {
	runCtx, cancel := context.WithTimeout(
		parent, time.Duration(job.MaxDurationSeconds)*time.Second,
	)
	defer cancel()

	d.mu.Lock()
	d.runningID = job.JobID
	d.cancelRun = cancel
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		d.runningID = ""
		d.cancelRun = nil
		d.mu.Unlock()
	}()

	log.Printf("running job %s: %s %v", job.JobID, job.DockerImage, job.Command)
	exitCode, runErr := d.runner.Run(runCtx, job.DockerImage, job.Command)

	var errMsg *string
	if runErr != nil {
		s := runErr.Error()
		errMsg = &s
		if exitCode == 0 {
			exitCode = 1
		}
	}
	// If the run was cancelled by the control plane, surface that explicitly so
	// the server can mark the job as cancelled (vs. failed) when the user has
	// already requested cancellation.
	if runCtx.Err() == context.Canceled {
		exitCode = -1
		s := "cancelled by user"
		errMsg = &s
	}

	if err := d.complete(context.Background(), job.JobID, exitCode, errMsg); err != nil {
		log.Printf("complete: %v", err)
	}
}

func (d *Daemon) heartbeat(ctx context.Context) (*heartbeatResp, error) {
	body, _ := json.Marshal(map[string]any{})
	url := strings.TrimRight(d.cfg.ControlPlaneURL, "/") +
		"/api/nodes/" + d.cfg.NodeID + "/heartbeat"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+d.cfg.AgentToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(raw))
	}
	var out heartbeatResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (d *Daemon) claim(ctx context.Context) (*JobAssignment, error) {
	url := strings.TrimRight(d.cfg.ControlPlaneURL, "/") + "/api/jobs/claim"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	req.Header.Set("Authorization", "Bearer "+d.cfg.AgentToken)
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(raw))
	}
	var out JobAssignment
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (d *Daemon) complete(ctx context.Context, jobID string, exitCode int, errMsg *string) error {
	payload := map[string]any{"exit_code": exitCode}
	if errMsg != nil {
		payload["error_message"] = *errMsg
	}
	body, _ := json.Marshal(payload)
	url := strings.TrimRight(d.cfg.ControlPlaneURL, "/") +
		"/api/jobs/" + jobID + "/complete"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+d.cfg.AgentToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

// DockerRunner shells out to the local docker CLI. v1 wires GPU access via
// --gpus all and discards container output; R6 will replace the io.Discard
// with a streaming sink that POSTs to /api/jobs/{id}/logs.
type DockerRunner struct{}

func (DockerRunner) Run(ctx context.Context, image string, command []string) (int, error) {
	args := append([]string{"run", "--rm", "--gpus", "all", image}, command...)
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	err := cmd.Run()
	if err == nil {
		return 0, nil
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode(), nil
	}
	return -1, err
}
