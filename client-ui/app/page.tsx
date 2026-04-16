"use client";

import { useState, useEffect, useCallback } from "react";

interface Job {
  id: string;
  docker_image: string;
  command: string[];
  gpu_count: number;
  status: string;
  exit_code: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  completed: { label: "Completed", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  queued: { label: "Waiting", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  running: { label: "Running", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  failed: { label: "Failed", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  cancelled: { label: "Cancelled", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
};

function timeAgo(dateStr: string): string {
  const seconds = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [command, setCommand] = useState("");
  const [gpuCount, setGpuCount] = useState(1);
  const [maxDuration, setMaxDuration] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    async function login() {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "kmalarifi97@gmail.com",
            password: "kmalarifi97@gmail.com",
          }),
        });
        if (!res.ok) {
          setAuthError("Could not connect to the network");
          return;
        }
        const data = await res.json();
        setToken(data.access_token || data.token);
      } catch {
        setAuthError("Could not connect to the network");
      }
    }
    login();
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/jobs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.items || []);
      }
    } catch {
      // retry on next interval
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [token, fetchJobs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSubmitting(true);
    setSubmitMessage(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          docker_image: "nvidia/cuda:12.2.0-base-ubuntu22.04",
          command: command.trim() ? command.trim().split(/\s+/) : ["nvidia-smi"],
          gpu_count: gpuCount,
          max_duration_seconds: maxDuration,
        }),
      });

      if (res.ok) {
        setSubmitMessage({ type: "success", text: "Job submitted! Watch it appear below." });
        setCommand("");
        fetchJobs();
      } else {
        const err = await res.json().catch(() => null);
        const msg = err?.detail || "Something went wrong";
        setSubmitMessage({ type: "error", text: msg });
      }
    } catch {
      setSubmitMessage({ type: "error", text: "Could not reach the network" });
    } finally {
      setSubmitting(false);
    }
  }

  const durationOptions = [
    { label: "1 minute", value: 60 },
    { label: "5 minutes", value: 300 },
    { label: "30 minutes", value: 1800 },
    { label: "1 hour", value: 3600 },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-4xl px-6 py-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="text-emerald-400">GPU Network</span>
          </h1>
          {token && (
            <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
              Connected
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {authError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-400 text-sm">
            {authError}
          </div>
        )}

        {/* Submit Job */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold text-zinc-100 mb-1">Run a GPU Job</h2>
          <p className="text-sm text-zinc-500 mb-6">Submit a command to run on a GPU machine in the network.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Command */}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Command to run
              </label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. nvidia-smi, python train.py --epochs 10"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-colors"
              />
              <p className="mt-1 text-xs text-zinc-600">Leave empty to run nvidia-smi (GPU info check)</p>
            </div>

            <div className="grid grid-cols-2 gap-5">
              {/* GPU Count */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  GPUs needed
                </label>
                <div className="flex gap-2">
                  {[1, 2, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGpuCount(n)}
                      className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                        gpuCount === n
                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                          : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {n} GPU{n > 1 ? "s" : ""}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Time limit
                </label>
                <select
                  value={maxDuration}
                  onChange={(e) => setMaxDuration(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-colors"
                >
                  {durationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {submitMessage && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  submitMessage.type === "success"
                    ? "border-green-500/30 bg-green-500/10 text-green-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}
              >
                {submitMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !token}
              className="w-full rounded-lg bg-emerald-600 px-8 py-3 text-sm font-semibold text-white hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Run Job"}
            </button>
          </form>
        </section>

        {/* Jobs History */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-zinc-100">Job History</h2>
            <span className="text-xs text-zinc-600">Updates every 5s</span>
          </div>

          {jobs.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              No jobs yet. Submit your first job above.
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const cfg = STATUS_CONFIG[job.status] || { label: job.status, color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" };
                return (
                  <div
                    key={job.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}
                      >
                        {cfg.label}
                      </span>
                      <div>
                        <span className="text-sm text-zinc-300">
                          {job.command.join(" ") || "nvidia-smi"}
                        </span>
                        <span className="text-xs text-zinc-600 ml-3">
                          {job.gpu_count} GPU{job.gpu_count > 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <span>{formatDuration(job.started_at, job.completed_at)}</span>
                      <span>{timeAgo(job.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
