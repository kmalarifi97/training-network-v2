"use client";

import { useEffect, useState, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DashboardData {
  users: { total: number; pending: number; active: number; suspended: number };
  nodes: { online: number; offline: number; draining: number };
  jobs: {
    queued: number;
    running: number;
    completed_24h: number;
    failed_24h: number;
    cancelled_24h: number;
  };
  compute: { gpu_hours_served_24h: number };
}

interface Node {
  id: string;
  name: string;
  gpu_model: string;
  gpu_count: number;
  gpu_memory_gb: number;
  status: string;
  last_seen_at: string;
  created_at: string;
}

interface Job {
  id: string;
  docker_image: string;
  command: string;
  gpu_count: number;
  status: string;
  exit_code: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (["online", "completed", "active", "succeeded"].includes(s))
    return "bg-emerald-500";
  if (["queued", "pending", "draining"].includes(s)) return "bg-amber-400";
  if (["offline", "failed", "suspended", "error"].includes(s))
    return "bg-red-500";
  if (["running"].includes(s)) return "bg-sky-400";
  if (["cancelled"].includes(s)) return "bg-zinc-400";
  return "bg-zinc-500";
}

function statusTextColor(status: string): string {
  const s = status.toLowerCase();
  if (["online", "completed", "active", "succeeded"].includes(s))
    return "text-emerald-400";
  if (["queued", "pending", "draining"].includes(s)) return "text-amber-400";
  if (["offline", "failed", "suspended", "error"].includes(s))
    return "text-red-400";
  if (["running"].includes(s)) return "text-sky-400";
  if (["cancelled"].includes(s)) return "text-zinc-400";
  return "text-zinc-400";
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + "..." : id;
}

function shortImage(img: string): string {
  // Show last segment of docker image, truncated
  const parts = img.split("/");
  const last = parts[parts.length - 1];
  return last.length > 30 ? last.slice(0, 27) + "..." : last;
}

/* ------------------------------------------------------------------ */
/*  Small components                                                   */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5 flex flex-col gap-1">
      <span className="text-sm text-muted font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className={`text-3xl font-bold tabular-nums ${color ?? "text-foreground"}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${statusColor(status)}`} />
      <span className={`text-sm font-medium capitalize ${statusTextColor(status)}`}>
        {status}
      </span>
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-foreground tracking-tight">
      {children}
    </h2>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400" />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-6 py-4 text-red-400 text-sm max-w-md text-center">
        {message}
      </div>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-lg bg-zinc-800 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const [jwt, setJwt] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  /* ---- Auth ---- */
  const login = useCallback(async () => {
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "kmalarifi97@gmail.com",
          password: "kmalarifi97@gmail.com",
        }),
      });
      if (!res.ok) throw new Error(`Login failed (${res.status})`);
      const data = await res.json();
      const token = data.access_token ?? data.token ?? data.jwt;
      if (!token) throw new Error("No token in response");
      setJwt(token);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Login failed");
    }
  }, []);

  useEffect(() => {
    login();
  }, [login]);

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async () => {
    if (!jwt) return;
    setDataError(null);
    const headers = { Authorization: `Bearer ${jwt}` };
    try {
      const [dashRes, nodesRes, jobsRes] = await Promise.all([
        fetch("/api/admin/dashboard", { headers }),
        fetch("/api/nodes", { headers }),
        fetch("/api/jobs?limit=10", { headers }),
      ]);

      if (dashRes.status === 401 || nodesRes.status === 401 || jobsRes.status === 401) {
        setJwt(null);
        setAuthError("Session expired. Re-authenticating...");
        login();
        return;
      }

      if (!dashRes.ok) throw new Error(`Dashboard API error (${dashRes.status})`);
      if (!nodesRes.ok) throw new Error(`Nodes API error (${nodesRes.status})`);
      if (!jobsRes.ok) throw new Error(`Jobs API error (${jobsRes.status})`);

      const [dashData, nodesData, jobsData] = await Promise.all([
        dashRes.json(),
        nodesRes.json(),
        jobsRes.json(),
      ]);

      setDashboard(dashData);
      setNodes(Array.isArray(nodesData) ? nodesData : nodesData.items ?? []);
      setJobs(jobsData.items ?? (Array.isArray(jobsData) ? jobsData : []));
      setLastRefresh(new Date());
    } catch (err: unknown) {
      setDataError(err instanceof Error ? err.message : "Failed to fetch data");
    }
  }, [jwt, login]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* ---- Render states ---- */
  if (authError) {
    return (
      <Shell>
        <ErrorBanner message={authError} onRetry={login} />
      </Shell>
    );
  }

  if (!jwt) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-32 gap-3">
          <Spinner />
          <p className="text-sm text-muted">Authenticating...</p>
        </div>
      </Shell>
    );
  }

  if (dataError && !dashboard) {
    return (
      <Shell>
        <ErrorBanner message={dataError} onRetry={fetchData} />
      </Shell>
    );
  }

  if (!dashboard) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  /* ---- Main dashboard ---- */
  const { users, nodes: nodeStats, jobs: jobStats, compute } = dashboard;

  return (
    <Shell>
      {/* Refresh indicator */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-xs text-muted">
          {lastRefresh
            ? `Last updated ${lastRefresh.toLocaleTimeString()} -- auto-refreshes every 10s`
            : "Loading..."}
        </p>
        {dataError && (
          <p className="text-xs text-amber-400">
            Refresh error: {dataError}
          </p>
        )}
      </div>

      {/* ---- Overview Cards ---- */}
      <section className="mb-10">
        <SectionHeading>Overview</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="GPU Hours (24h)" value={compute.gpu_hours_served_24h.toFixed(1)} color="text-violet-400" />
          <StatCard label="Jobs Running" value={jobStats.running} color="text-sky-400" />
          <StatCard label="Nodes Online" value={nodeStats.online} color="text-emerald-400" />
          <StatCard label="Active Users" value={users.active} color="text-emerald-400" />
        </div>
      </section>

      {/* ---- Detail Cards ---- */}
      <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Users */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-4">Users</h3>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-zinc-400">Total</span><span className="font-semibold">{users.total}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Active</span><span className="font-semibold text-emerald-400">{users.active}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Pending</span><span className="font-semibold text-amber-400">{users.pending}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Suspended</span><span className="font-semibold text-red-400">{users.suspended}</span></div>
          </div>
        </div>

        {/* Nodes */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-4">Nodes</h3>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-zinc-400">Online</span><span className="font-semibold text-emerald-400">{nodeStats.online}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Offline</span><span className="font-semibold text-red-400">{nodeStats.offline}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Draining</span><span className="font-semibold text-amber-400">{nodeStats.draining}</span></div>
          </div>
        </div>

        {/* Jobs */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-4">Jobs (24h)</h3>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-zinc-400">Queued</span><span className="font-semibold text-amber-400">{jobStats.queued}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Running</span><span className="font-semibold text-sky-400">{jobStats.running}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Completed</span><span className="font-semibold text-emerald-400">{jobStats.completed_24h}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Failed</span><span className="font-semibold text-red-400">{jobStats.failed_24h}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Cancelled</span><span className="font-semibold text-zinc-400">{jobStats.cancelled_24h}</span></div>
          </div>
        </div>
      </section>

      {/* ---- Nodes table ---- */}
      <section className="mb-10">
        <SectionHeading>All Nodes</SectionHeading>
        <div className="mt-3 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">GPU</th>
                <th className="px-4 py-3 font-medium text-center">Count</th>
                <th className="px-4 py-3 font-medium text-center">VRAM</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {nodes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No nodes registered
                  </td>
                </tr>
              )}
              {nodes.map((node) => (
                <tr
                  key={node.id}
                  className="bg-card/50 hover:bg-card transition-colors"
                >
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    {node.name}
                    <span className="ml-2 text-xs text-muted font-mono">
                      {shortId(node.id)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-300">
                    {node.gpu_model}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {node.gpu_count}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {node.gpu_memory_gb} GB
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={node.status} />
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {timeAgo(node.last_seen_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Jobs table ---- */}
      <section className="mb-10">
        <SectionHeading>Recent Jobs</SectionHeading>
        <div className="mt-3 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium text-center">GPUs</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No recent jobs
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="bg-card/50 hover:bg-card transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-zinc-300">
                    {shortId(job.id)}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {job.gpu_count}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {timeAgo(job.created_at)}
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {jobDuration(job)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

/* ---- Shell wraps the page with header ---- */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center">
          <h1 className="text-base font-semibold tracking-tight">
            <span className="text-emerald-400">GPU Network</span>
            <span className="text-muted mx-2">--</span>
            <span className="text-zinc-300">Admin</span>
          </h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}

/* ---- Duration helper ---- */
function jobDuration(job: Job): string {
  const start = job.started_at;
  const end = job.completed_at;
  if (!start) return "--";
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  const diffSec = Math.max(0, Math.floor((to - from) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
