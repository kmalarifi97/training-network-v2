// Package agent contains the worker daemon's polling loop. The daemon
// heartbeats the control plane on a fixed cadence, claims queued jobs when
// idle, runs them via the configured ContainerRunner, and reports completion.
//
// Job output is streamed back to the control plane via a per-job logPump that
// buffers lines and POSTs them to /api/jobs/{id}/logs on a short cadence. Log
// streams are tagged stdout, stderr, or system (platform-level events such as
// "Pulling image..." and "Container exited").
package agent

import (
	"bufio"
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

// DefaultLogFlushInterval is how often the per-job log pump ships buffered
// lines upstream. Short enough to feel live in a UI tail, long enough to
// batch bursts into fewer POSTs.
const DefaultLogFlushInterval = 500 * time.Millisecond

// HTTPClient is satisfied by *http.Client. Stubbed in tests.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// LogEmitter is how a container runner reports output and platform events
// back to the daemon for upstream shipping.
type LogEmitter interface {
	Emit(stream, line string)
}

// ContainerRunner owns pulling the image and running the container.
// Implementations must stream every line they see to the provided emitter.
type ContainerRunner interface {
	Run(ctx context.Context, image string, command []string, emit LogEmitter) (exitCode int, err error)
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

	// Per-job log pump: background flusher ships buffered lines every ~500ms.
	// Stopped and final-flushed below so the demo never loses the tail of a
	// job (the "Container exited" line tends to be the dramatic one).
	pump := newLogPump(d.httpClient, d.cfg.ControlPlaneURL, d.cfg.AgentToken, job.JobID)
	pumpCtx, pumpCancel := context.WithCancel(context.Background())
	go pump.run(pumpCtx)
	defer func() {
		pumpCancel()
		finalCtx, finalCancel := context.WithTimeout(context.Background(), 3*time.Second)
		pump.flush(finalCtx)
		finalCancel()
	}()

	pump.Emit("system", fmt.Sprintf("Job %s assigned to node %s", job.JobID, d.cfg.NodeID))
	log.Printf("running job %s: %s %v", job.JobID, job.DockerImage, job.Command)

	exitCode, runErr := d.runner.Run(runCtx, job.DockerImage, job.Command, pump)

	var errMsg *string
	if runErr != nil {
		s := runErr.Error()
		errMsg = &s
		if exitCode == 0 {
			exitCode = 1
		}
		pump.Emit("system", "Runner error: "+s)
	}
	// If the run was cancelled by the control plane, surface that explicitly so
	// the server can mark the job as cancelled (vs. failed) when the user has
	// already requested cancellation.
	if runCtx.Err() == context.Canceled {
		exitCode = -1
		s := "cancelled by user"
		errMsg = &s
		pump.Emit("system", "Cancelled by user request")
	}
	pump.Emit("system", fmt.Sprintf("Container exited (code %d)", exitCode))

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

// DockerRunner shells out to the local docker CLI. Pulls the image first so
// progress lines stream as a separate phase before the container output
// starts, which makes the demo narrate itself ("Pulling... Starting... Loss
// 2.4... Container exited").
type DockerRunner struct{}

func (DockerRunner) Run(ctx context.Context, image string, command []string, emit LogEmitter) (int, error) {
	if err := dockerPull(ctx, image, emit); err != nil {
		return -1, err
	}
	return dockerRun(ctx, image, command, emit)
}

func dockerPull(ctx context.Context, image string, emit LogEmitter) error {
	emit.Emit("system", "Pulling image "+image+"...")
	cmd := exec.CommandContext(ctx, "docker", "pull", image)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("docker pull start: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go streamPipe(&wg, stdout, "system", emit)
	go streamPipe(&wg, stderr, "system", emit)
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("docker pull failed: %w", err)
	}
	emit.Emit("system", "Image "+image+" ready")
	return nil
}

func dockerRun(ctx context.Context, image string, command []string, emit LogEmitter) (int, error) {
	emit.Emit("system", "Starting container with --gpus all")
	args := append([]string{"run", "--rm", "--gpus", "all", image}, command...)
	cmd := exec.CommandContext(ctx, "docker", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return -1, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return -1, err
	}
	if err := cmd.Start(); err != nil {
		return -1, fmt.Errorf("docker run start: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go streamPipe(&wg, stdout, "stdout", emit)
	go streamPipe(&wg, stderr, "stderr", emit)
	wg.Wait()

	err = cmd.Wait()
	if err == nil {
		return 0, nil
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode(), nil
	}
	return -1, err
}

// streamPipe reads line-by-line from r and emits each line tagged with
// stream. Long docker-pull progress lines (up to ~1 MB) are accepted.
// Carriage returns are stripped so progress-bar refreshes that use \r land as
// a single line instead of a blob of control characters.
func streamPipe(wg *sync.WaitGroup, r io.Reader, stream string, emit LogEmitter) {
	defer wg.Done()
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r\n")
		if line == "" {
			continue
		}
		emit.Emit(stream, line)
	}
}

// logPump buffers emitted log lines and periodically POSTs them to
// /api/jobs/{id}/logs. Best-effort: network failures log and drop the batch —
// log streaming is not correctness-critical for the job itself.
type logPump struct {
	client  HTTPClient
	baseURL string
	token   string
	jobID   string

	mu      sync.Mutex
	buf     []logEntry
	nextSeq int

	flushInterval time.Duration
}

type logEntry struct {
	Stream   string `json:"stream"`
	Content  string `json:"content"`
	Sequence int    `json:"sequence"`
}

func newLogPump(client HTTPClient, baseURL, token, jobID string) *logPump {
	return &logPump{
		client:        client,
		baseURL:       baseURL,
		token:         token,
		jobID:         jobID,
		flushInterval: DefaultLogFlushInterval,
	}
}

// Emit appends one line to the buffer. Safe for concurrent callers — stdout
// and stderr scanners emit in parallel.
func (p *logPump) Emit(stream, content string) {
	if content == "" {
		return
	}
	p.mu.Lock()
	p.buf = append(p.buf, logEntry{
		Stream: stream, Content: content, Sequence: p.nextSeq,
	})
	p.nextSeq++
	p.mu.Unlock()
}

// run blocks until ctx is cancelled, flushing on a regular interval.
func (p *logPump) run(ctx context.Context) {
	ticker := time.NewTicker(p.flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.flush(ctx)
		}
	}
}

// flush takes a snapshot of the current buffer and POSTs it to the control
// plane. Errors log and drop — log delivery is best-effort.
func (p *logPump) flush(ctx context.Context) {
	p.mu.Lock()
	if len(p.buf) == 0 {
		p.mu.Unlock()
		return
	}
	batch := p.buf
	p.buf = nil
	p.mu.Unlock()

	body, err := json.Marshal(batch)
	if err != nil {
		log.Printf("log pump: marshal: %v", err)
		return
	}
	url := strings.TrimRight(p.baseURL, "/") + "/api/jobs/" + p.jobID + "/logs"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		log.Printf("log pump: request: %v", err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		log.Printf("log pump: post: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(resp.Body)
		log.Printf("log pump: status %d: %s", resp.StatusCode, string(raw))
	}
}
