"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NodeRow {
  id: string;
  name: string;
  gpu_model: string;
  gpu_memory_gb: number;
  gpu_count: number;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

interface Job {
  id: string;
  docker_image: string;
  command: string[];
  gpu_count: number;
  status: string;
  exit_code: number | null;
  error_message: string | null;
  assigned_node_id: string | null;
  preferred_node_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface LogEntry {
  stream: "stdout" | "stderr" | "system";
  content: string;
  sequence: number;
  received_at: string;
}

type Phase = "login" | "gpus" | "submit" | "running";

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_IMAGE = "kmalarifi/llm-finetune:v1";
const DEFAULT_REPO = "https://github.com/kmalarifi/finetune-demo";

function timeAgo(ts: string | null): string {
  if (!ts) return "—";
  const delta = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function streamColor(stream: LogEntry["stream"]): string {
  if (stream === "stdout") return "text-zinc-100";
  if (stream === "stderr") return "text-amber-300";
  return "text-sky-400";
}

function buildTrainCommand(repoUrl: string, epochs: number): string[] {
  const safeRepo = repoUrl.trim().replace(/['"]/g, "");
  const safeEpochs = Math.max(1, Math.floor(epochs));
  return [
    "bash",
    "-c",
    `git clone --depth 1 ${safeRepo} repo && cd repo && python3 train.py --epochs ${safeEpochs}`,
  ];
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [phase, setPhase] = useState<Phase>("login");
  const [token, setToken] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeRow | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  // Boot: check for a stored token.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("gpu_token") : null;
    if (saved) {
      setToken(saved);
      setPhase("gpus");
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("gpu_token");
    setToken(null);
    setSelectedNode(null);
    setJob(null);
    setPhase("login");
  }, []);

  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans">
      <Header phase={phase} selectedNode={selectedNode} onLogout={logout} hasToken={!!token} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {phase === "login" && (
          <LoginView
            onSuccess={(t) => {
              localStorage.setItem("gpu_token", t);
              setToken(t);
              setPhase("gpus");
            }}
          />
        )}
        {phase === "gpus" && token && (
          <BrowseView
            token={token}
            nodes={nodes}
            setNodes={setNodes}
            onPick={(n) => {
              setSelectedNode(n);
              setPhase("submit");
            }}
            onUnauthorized={handleUnauthorized}
          />
        )}
        {phase === "submit" && token && selectedNode && (
          <SubmitView
            token={token}
            node={selectedNode}
            onBack={() => setPhase("gpus")}
            onSubmitted={(j) => {
              setJob(j);
              setPhase("running");
            }}
            onUnauthorized={handleUnauthorized}
          />
        )}
        {phase === "running" && token && selectedNode && job && (
          <RunningView
            token={token}
            node={selectedNode}
            job={job}
            onDone={(updated) => setJob(updated)}
            onNew={() => {
              setJob(null);
              setPhase("submit");
            }}
            onUnauthorized={handleUnauthorized}
          />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header({
  phase,
  selectedNode,
  onLogout,
  hasToken,
}: {
  phase: Phase;
  selectedNode: NodeRow | null;
  onLogout: () => void;
  hasToken: boolean;
}) {
  const crumbs: string[] = ["Network"];
  if (phase === "gpus" || phase === "submit" || phase === "running") crumbs.push("GPUs");
  if ((phase === "submit" || phase === "running") && selectedNode) crumbs.push(selectedNode.name);
  if (phase === "running") crumbs.push("Live");

  return (
    <header className="border-b border-zinc-800 bg-[#0a0a0a]/90 backdrop-blur-sm sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold tracking-tight">
            <span className="text-emerald-400">GPU</span> Network
          </span>
          <span className="text-zinc-600">/</span>
          <nav className="text-sm text-zinc-400 flex items-center gap-1">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-700">›</span>}
                <span className={i === crumbs.length - 1 ? "text-zinc-200" : ""}>{c}</span>
              </span>
            ))}
          </nav>
        </div>
        {hasToken && (
          <button
            onClick={onLogout}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

function LoginView({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.detail ?? `Login failed (${r.status})`);
      }
      const data = await r.json();
      const token = data.access_token ?? data.token;
      if (!token) throw new Error("Login response missing token");
      onSuccess(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8">
        <h1 className="text-2xl font-semibold text-zinc-100 mb-1">Sign in</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Access the GPU network. Use your registered account.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Browse GPUs                                                        */
/* ------------------------------------------------------------------ */

function BrowseView({
  token,
  nodes,
  setNodes,
  onPick,
  onUnauthorized,
}: {
  token: string;
  nodes: NodeRow[];
  setNodes: (n: NodeRow[]) => void;
  onPick: (n: NodeRow) => void;
  onUnauthorized: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/nodes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) {
        onUnauthorized();
        return;
      }
      if (!r.ok) throw new Error(`Nodes API returned ${r.status}`);
      const data = await r.json();
      setNodes(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load nodes");
    } finally {
      setLoading(false);
    }
  }, [token, setNodes, onUnauthorized]);

  useEffect(() => {
    fetchNodes();
    const t = setInterval(fetchNodes, 10_000);
    return () => clearInterval(t);
  }, [fetchNodes]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Available GPUs</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Pick a GPU to run a training job on. Jobs are dispatched to the selected machine.
          </p>
        </div>
        <button
          onClick={fetchNodes}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading nodes…</div>
      ) : nodes.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
          <p className="text-zinc-400">No GPU nodes are registered on this network yet.</p>
          <p className="text-zinc-600 text-xs mt-2">
            Hosts register nodes by running <code>gpu-agent init</code> on their machines.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((n) => (
            <GpuCard key={n.id} node={n} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function GpuCard({ node, onPick }: { node: NodeRow; onPick: (n: NodeRow) => void }) {
  const online = node.status === "online";
  const available = online;
  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        available
          ? "border-zinc-800 bg-zinc-900/50 hover:border-emerald-500/40"
          : "border-zinc-800 bg-zinc-900/30 opacity-70"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-zinc-100 truncate">{node.name}</h3>
        <StatusPill status={node.status} />
      </div>
      <div className="space-y-1.5 text-sm text-zinc-400">
        <div className="flex justify-between">
          <span>GPU model</span>
          <span className="text-zinc-200 font-mono text-xs">{node.gpu_model}</span>
        </div>
        <div className="flex justify-between">
          <span>GPUs</span>
          <span className="text-zinc-200 tabular-nums">{node.gpu_count}</span>
        </div>
        <div className="flex justify-between">
          <span>VRAM</span>
          <span className="text-zinc-200 tabular-nums">{node.gpu_memory_gb} GB</span>
        </div>
        <div className="flex justify-between">
          <span>Last seen</span>
          <span className="text-zinc-500">{timeAgo(node.last_seen_at)}</span>
        </div>
      </div>
      <button
        disabled={!available}
        onClick={() => onPick(node)}
        className="mt-5 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors"
      >
        {available ? "Use this GPU →" : `Unavailable (${node.status})`}
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    online: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    offline: "bg-red-500/15 text-red-300 border-red-500/30",
    draining: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };
  const c = palette[status] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${c}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Submit                                                             */
/* ------------------------------------------------------------------ */

function SubmitView({
  token,
  node,
  onBack,
  onSubmitted,
  onUnauthorized,
}: {
  token: string;
  node: NodeRow;
  onBack: () => void;
  onSubmitted: (job: Job) => void;
  onUnauthorized: () => void;
}) {
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const [epochs, setEpochs] = useState(3);
  const [maxMinutes, setMaxMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cmdPreview = useMemo(
    () => buildTrainCommand(repoUrl, epochs).join(" "),
    [repoUrl, epochs],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        docker_image: image.trim(),
        command: buildTrainCommand(repoUrl, epochs),
        gpu_count: 1,
        max_duration_seconds: Math.max(60, maxMinutes * 60),
        preferred_node_id: node.id,
      };
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (r.status === 401) {
        onUnauthorized();
        return;
      }
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.detail ?? `Submit failed (${r.status})`);
      }
      const job = (await r.json()) as Job;
      onSubmitted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
      >
        ← Back to GPUs
      </button>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Run a training job</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Submitting to{" "}
        <span className="text-emerald-400 font-mono">{node.name}</span> ·{" "}
        <span className="text-zinc-400">
          {node.gpu_model} · {node.gpu_memory_gb} GB
        </span>
      </p>

      <form
        onSubmit={submit}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-5"
      >
        <Field
          label="Docker image"
          hint="Public image on Docker Hub. The environment, not the code."
        >
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            required
            className="font-mono text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </Field>

        <Field
          label="GitHub repo URL"
          hint="Cloned fresh at container start. Must contain train.py + data/train.csv."
        >
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            required
            className="font-mono text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Epochs" hint="Passes over the training data.">
            <input
              type="number"
              min={1}
              max={50}
              value={epochs}
              onChange={(e) => setEpochs(Number(e.target.value))}
              required
              className="text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </Field>
          <Field label="Max duration (min)" hint="Safety ceiling; the job is killed if it exceeds this.">
            <input
              type="number"
              min={1}
              max={1440}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(Number(e.target.value))}
              required
              className="text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </Field>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1.5">
            Command that will run
          </div>
          <pre className="rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {cmdPreview}
          </pre>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Submitting…" : "🚀 Start Processing"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Running (live view)                                                */
/* ------------------------------------------------------------------ */

function RunningView({
  token,
  node,
  job,
  onDone,
  onNew,
  onUnauthorized,
}: {
  token: string;
  node: NodeRow;
  job: Job;
  onDone: (j: Job) => void;
  onNew: () => void;
  onUnauthorized: () => void;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState(job.status);
  const [exitCode, setExitCode] = useState<number | null>(job.exit_code);
  const [pollError, setPollError] = useState<string | null>(null);
  const lastSeq = useRef<number>(-1);
  const logRef = useRef<HTMLDivElement>(null);

  const terminal = status === "completed" || status === "failed" || status === "cancelled";

  const poll = useCallback(async () => {
    try {
      const [jobRes, logsRes] = await Promise.all([
        fetch(`/api/jobs/${job.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/jobs/${job.id}/logs?after_sequence=${lastSeq.current}&limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (jobRes.status === 401 || logsRes.status === 401) {
        onUnauthorized();
        return;
      }

      if (jobRes.ok) {
        const j = (await jobRes.json()) as Job;
        setStatus(j.status);
        setExitCode(j.exit_code);
        onDone(j);
      }

      if (logsRes.ok) {
        const data = await logsRes.json();
        const items: LogEntry[] = data.items ?? [];
        if (items.length > 0) {
          setLogs((prev) => [...prev, ...items]);
          lastSeq.current = items[items.length - 1].sequence;
        }
      }
      setPollError(null);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : "Poll error");
    }
  }, [job.id, token, onDone, onUnauthorized]);

  useEffect(() => {
    poll();
    if (terminal) return;
    const t = setInterval(poll, 750);
    return () => clearInterval(t);
  }, [poll, terminal]);

  // Auto-scroll the log stream as lines come in.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const { answer, lossLine } = useMemo(() => extractHighlights(logs), [logs]);

  async function cancelJob() {
    await fetch(`/api/jobs/${job.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    poll();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Job <span className="font-mono text-zinc-400 text-lg">{job.id.slice(0, 8)}</span>
          </h1>
          <p className="text-sm text-zinc-500">
            on <span className="text-emerald-400 font-mono">{node.name}</span> ·{" "}
            <span className="uppercase tracking-wide">{status}</span>
            {terminal && exitCode !== null && (
              <span className="ml-2 text-zinc-500">exit code {exitCode}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!terminal && (
            <button
              onClick={cancelJob}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 transition-colors"
            >
              Cancel job
            </button>
          )}
          {terminal && (
            <button
              onClick={onNew}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              Run another →
            </button>
          )}
        </div>
      </div>

      {pollError && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Polling: {pollError} (retrying)
        </div>
      )}

      {/* Highlights row — the demo "wow" bar */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <HighlightCard label="Status" value={status} tone={statusTone(status)} />
        <HighlightCard
          label="Latest loss"
          value={lossLine ?? "—"}
          tone={lossLine ? "info" : "muted"}
        />
        <HighlightCard
          label="Answer / result"
          value={answer ?? (terminal ? "—" : "…pending")}
          tone={answer ? "ok" : "muted"}
        />
      </div>

      {/* Two-panel live view */}
      <div className="grid md:grid-cols-2 gap-4 h-[480px]">
        <LogPanel
          title="Container output"
          subtitle="stdout + stderr from your script"
          logs={logs.filter((l) => l.stream !== "system")}
          emptyHint="Waiting for container to start…"
          refProp={logRef}
        />
        <LogPanel
          title="Platform activity"
          subtitle="Pulls, lifecycle events, scheduler messages"
          logs={logs.filter((l) => l.stream === "system")}
          emptyHint="Job has not started yet."
          tintSystem
        />
      </div>
    </div>
  );
}

function statusTone(s: string): HighlightTone {
  if (s === "running") return "info";
  if (s === "completed") return "ok";
  if (s === "failed") return "err";
  if (s === "cancelled") return "muted";
  return "muted";
}

type HighlightTone = "ok" | "info" | "err" | "muted";

function HighlightCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: HighlightTone;
}) {
  const toneClass = {
    ok: "text-emerald-400",
    info: "text-sky-400",
    err: "text-red-400",
    muted: "text-zinc-400",
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-sm font-mono truncate ${toneClass}`}>{value}</div>
    </div>
  );
}

function LogPanel({
  title,
  subtitle,
  logs,
  emptyHint,
  tintSystem = false,
  refProp,
}: {
  title: string;
  subtitle: string;
  logs: LogEntry[];
  emptyHint: string;
  tintSystem?: boolean;
  refProp?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-black/50 flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-zinc-200">{title}</div>
          <div className="text-xs text-zinc-500">{subtitle}</div>
        </div>
        <span className="text-xs text-zinc-600 tabular-nums">{logs.length} lines</span>
      </div>
      <div
        ref={refProp}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600">{emptyHint}</div>
        ) : (
          logs.map((l) => (
            <div key={l.sequence} className={streamColor(l.stream)}>
              {tintSystem && l.stream === "system" && (
                <span className="text-sky-500/70 mr-2">▸</span>
              )}
              <span className="text-zinc-600 mr-2 tabular-nums">
                {String(l.sequence).padStart(3, "0")}
              </span>
              {l.content}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function extractHighlights(logs: LogEntry[]): { answer: string | null; lossLine: string | null } {
  let answer: string | null = null;
  let lossLine: string | null = null;
  for (const l of logs) {
    if (l.stream === "stdout") {
      if (l.content.startsWith("ANSWER:")) answer = l.content.slice("ANSWER:".length).trim();
      const lossMatch = l.content.match(/'loss'\s*:\s*([\d.]+)/);
      if (lossMatch) lossLine = `loss ${lossMatch[1]}  (${l.content.slice(0, 60)}…)`;
      const simpleLoss = l.content.match(/loss[:=]\s*([\d.]+)/i);
      if (!lossMatch && simpleLoss) lossLine = `loss ${simpleLoss[1]}`;
    }
  }
  return { answer, lossLine };
}
