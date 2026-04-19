const TOKEN_KEY = "gpu_jwt";
const EMAIL_KEY = "gpu_email";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(EMAIL_KEY);
}

export function getEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(EMAIL_KEY);
}

export function setEmail(email: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMAIL_KEY, email);
}

export class ApiError extends Error {
  status: number;
  detail: string;
  payload?: unknown;
  constructor(status: number, detail: string, payload?: unknown) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.payload = payload;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail =
      (payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : null) ?? res.statusText;
    throw new ApiError(res.status, detail, payload);
  }
  return payload as T;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in_seconds: number;
}

export interface UserResponse {
  id: string;
  email: string;
  status: string;
  can_host: boolean;
  can_rent: boolean;
  is_admin: boolean;
  credits_gpu_hours: number;
  created_at: string;
}

export interface NodePublic {
  id: string;
  name: string;
  gpu_model: string;
  gpu_memory_gb: number;
  gpu_count: number;
  status: "online" | "offline" | "draining";
  last_seen_at: string | null;
  created_at: string;
}

export interface NodeMarketplace extends NodePublic {
  host_handle: string;
}

export interface ClaimTokenResponse {
  token: string;
  prefix: string;
  install_command: string;
  expires_at: string;
}

export interface JobPublic {
  id: string;
  docker_image: string;
  command: string[];
  gpu_count: number;
  max_duration_seconds: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  exit_code: number | null;
  error_message: string | null;
  assigned_node_id: string | null;
  preferred_node_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobLogEntry {
  stream: "stdout" | "stderr" | "system";
  content: string;
  sequence: number;
  received_at: string;
}

export interface JobLogListResponse {
  items: JobLogEntry[];
}

export interface JobListResponse {
  items: JobPublic[];
  next_cursor: string | null;
}
