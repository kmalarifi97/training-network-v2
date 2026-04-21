"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiFetch,
  clearToken,
  getEmail,
  getToken,
  setEmail as persistEmail,
  setToken,
  type ApiError,
  type ClaimTokenResponse,
  type JobLogEntry,
  type JobLogListResponse,
  type JobPublic,
  type NodeMarketplace,
  type NodePublic,
  type TokenResponse,
  type UserResponse,
} from "@/lib/api";

const DEFAULT_IMAGE = "nvidia/cuda:12.2.0-base-ubuntu22.04";
const DEFAULT_COMMAND = "nvidia-smi";

function handleFromEmail(email: string): string {
  const prefix = email.includes("@") ? email.split("@", 1)[0] : email;
  return "@" + prefix;
}

/* ==================================================================
   State machine + helpers
   ================================================================== */

type Phase =
  | "loading"
  | "login"
  | "pending_approval"
  | "rent_browse"
  | "rent_submit"
  | "rent_running"
  | "rent_done"
  | "my_gpus"
  | "add_gpu_form"
  | "add_gpu_success"
  | "cli_install";

/* Which sidebar section each phase belongs to. */
function sidebarSection(p: Phase): "rent" | "host" | "cli" | null {
  if (p === "login" || p === "loading" || p === "pending_approval") return null;
  if (p === "cli_install") return "cli";
  if (p.startsWith("rent_")) return "rent";
  return "host";
}

function streamColor(s: "stdout" | "stderr" | "system"): string {
  if (s === "stdout") return "text-foreground";
  if (s === "stderr") return "text-amber-800";
  return "text-sky-400";
}

function translateJobStatus(s: string): string {
  if (s === "queued") return "في قائمة الانتظار";
  if (s === "running") return "قيد التنفيذ";
  if (s === "completed") return "اكتملت";
  if (s === "failed") return "فشلت";
  if (s === "cancelled") return "ألغيت";
  return s;
}

function translateStatus(s: string): string {
  if (s === "online") return "متصل";
  if (s === "offline") return "غير متصل";
  if (s === "draining") return "قيد الإفراغ";
  return s;
}

function timeAgoAr(iso: string | null): string {
  if (!iso) return "لم يتصل بعد";
  const delta = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (delta < 10) return "الآن";
  if (delta < 60) return `قبل ${delta} ثانية`;
  const mins = Math.floor(delta / 60);
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `قبل ${days} يوم`;
}

/* ==================================================================
   Root
   ================================================================== */

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<UserResponse | null>(null);
  const [selectedRentable, setSelectedRentable] = useState<NodeMarketplace | null>(null);
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [command, setCommand] = useState(DEFAULT_COMMAND);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [newGpuName, setNewGpuName] = useState("");
  const [claimToken, setClaimToken] = useState<ClaimTokenResponse | null>(null);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setSelectedRentable(null);
    setPhase("login");
  }, []);

  const onAuthenticated = useCallback((me: UserResponse) => {
    setUser(me);
    setPhase(me.status === "active" ? "rent_browse" : "pending_approval");
  }, []);

  // On mount: if a JWT is persisted, fetch /api/me to confirm it's still valid
  // and route based on user.status. Otherwise go to login.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!getToken()) {
        setPhase("login");
        return;
      }
      try {
        const me = await apiFetch<UserResponse>("/api/me");
        if (!cancelled) onAuthenticated(me);
      } catch {
        if (cancelled) return;
        clearToken();
        setPhase("login");
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [onAuthenticated]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackgroundGrain />
      <Header phase={phase} user={user} onLogout={logout} />

      {phase === "loading" && <LoadingView />}

      {phase === "login" && (
        <main className="relative mx-auto max-w-6xl px-6 py-10">
          <LoginView onSuccess={onAuthenticated} />
        </main>
      )}

      {phase === "pending_approval" && user && (
        <main className="relative mx-auto max-w-6xl px-6 py-10">
          <PendingApprovalView user={user} />
        </main>
      )}

      {phase !== "loading" && phase !== "login" && phase !== "pending_approval" && (
        <div className="relative mx-auto max-w-7xl px-6 py-8 flex gap-8">
          <Sidebar phase={phase} onNavigate={setPhase} />
          <main className="flex-1 min-w-0">
            {phase === "rent_browse" && (
              <RentBrowseView
                onPick={(g) => {
                  setSelectedRentable(g);
                  setPhase("rent_submit");
                }}
              />
            )}
            {phase === "rent_submit" && selectedRentable && (
              <RentSubmitView
                gpu={selectedRentable}
                image={image}
                setImage={setImage}
                command={command}
                setCommand={setCommand}
                onBack={() => setPhase("rent_browse")}
                onStart={(id) => {
                  setActiveJobId(id);
                  setPhase("rent_running");
                }}
              />
            )}
            {phase === "rent_running" && selectedRentable && activeJobId && (
              <RunningView
                gpu={selectedRentable}
                image={image}
                jobId={activeJobId}
                onComplete={() => setPhase("rent_done")}
                onCancel={() => {
                  setActiveJobId(null);
                  setPhase("rent_browse");
                }}
              />
            )}
            {phase === "rent_done" && selectedRentable && activeJobId && (
              <DoneView
                gpu={selectedRentable}
                image={image}
                jobId={activeJobId}
                onAgain={() => setPhase("rent_submit")}
                onHome={() => {
                  setActiveJobId(null);
                  setSelectedRentable(null);
                  setPhase("rent_browse");
                }}
              />
            )}
            {phase === "my_gpus" && (
              <MyGpusView
                onAddNew={() => {
                  setNewGpuName("");
                  setPhase("add_gpu_form");
                }}
              />
            )}
            {phase === "add_gpu_form" && (
              <AddGpuFormView
                name={newGpuName}
                setName={setNewGpuName}
                onBack={() => setPhase("my_gpus")}
                onSuccess={(data) => {
                  setClaimToken(data);
                  setPhase("add_gpu_success");
                }}
              />
            )}
            {phase === "add_gpu_success" && claimToken && (
              <AddGpuSuccessView
                name={newGpuName || "جهازي الجديد"}
                claim={claimToken}
                onDone={() => {
                  setClaimToken(null);
                  setPhase("my_gpus");
                }}
              />
            )}
            {phase === "cli_install" && <CliInstallView />}
          </main>
        </div>
      )}
      <Footer />
    </div>
  );
}

/* ==================================================================
   Decorative background
   ================================================================== */

function BackgroundGrain() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] -z-10"
        style={{
          background:
            "radial-gradient(ellipse at 50% -10%, rgba(16,185,129,0.10), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </>
  );
}

/* ==================================================================
   Header
   ================================================================== */

function Header({
  phase,
  user,
  onLogout,
}: {
  phase: Phase;
  user: UserResponse | null;
  onLogout: () => void;
}) {
  const sec = sidebarSection(phase);
  const sectionLabel =
    sec === "rent"
      ? "استئجار GPU"
      : sec === "host"
        ? "إضافة GPU للتأجير"
        : sec === "cli"
          ? "سطر الأوامر"
          : "";

  return (
    <header className="relative border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent to-cat-amber flex items-center justify-center font-bold text-black text-sm">
              ش
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight">
                شبكة <span className="text-accent">GPU</span>
              </div>
              <div className="text-[10px] text-muted tracking-wide">
                شبكة خفيفة · أجهزتك · تحت سيطرتك
              </div>
            </div>
          </div>
          {sectionLabel && (
            <>
              <span className="text-muted">|</span>
              <div className="text-sm text-muted-hi">{sectionLabel}</div>
            </>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-xs text-muted-hi">{handleFromEmail(user.email)}</div>
              <div className="text-[10px] text-muted" dir="ltr">{user.email}</div>
              <div className="text-[10px] text-accent tabular-nums" dir="ltr">
                {user.credits_gpu_hours} GPU-ساعة
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-muted hover:text-muted-hi transition-colors"
            >
              تسجيل الخروج
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/* ==================================================================
   Sidebar (after login only)
   ================================================================== */

function Sidebar({
  phase,
  onNavigate,
}: {
  phase: Phase;
  onNavigate: (p: Phase) => void;
}) {
  const sec = sidebarSection(phase);

  const items = [
    {
      section: "host" as const,
      label: "إضافة GPU للتأجير",
      hint: "شارك أجهزتك مع الشبكة",
      icon: "+",
      target: "my_gpus" as Phase,
    },
    {
      section: "rent" as const,
      label: "استئجار GPU",
      hint: "شغل مهامك على جهاز شخص آخر",
      icon: "⚡",
      target: "rent_browse" as Phase,
    },
    {
      section: "cli" as const,
      label: "سطر الأوامر",
      hint: "استخدم GPU Network من الترمنال",
      icon: ">_",
      target: "cli_install" as Phase,
    },
  ];

  return (
    <aside className="w-64 flex-shrink-0">
      <div className="sticky top-24">
        <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
          {items.map((it) => {
            const active = sec === it.section;
            return (
              <button
                key={it.section}
                onClick={() => onNavigate(it.target)}
                className={`w-full text-right rounded-lg p-3 transition-colors group ${
                  active
                    ? "bg-accent-dim border border-accent/30"
                    : "hover:bg-surface-hi border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`h-7 w-7 rounded-md flex items-center justify-center text-sm flex-shrink-0 ${
                      active
                        ? "bg-accent-dim text-accent"
                        : "bg-surface-hi text-muted-hi group-hover:text-foreground"
                    }`}
                  >
                    {it.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-medium ${
                        active ? "text-accent" : "text-foreground"
                      }`}
                    >
                      {it.label}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 leading-tight">
                      {it.hint}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* small stats panel at the bottom */}
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-2">
            حالة شبكتك
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-hi">أجهزتي المتصلة</span>
              <span className="text-accent font-semibold">2 / 2</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-hi">أجهزة متاحة للتأجير</span>
              <span className="text-foreground font-semibold">4</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-hi">ساعات GPU مجمعة</span>
              <span className="text-foreground font-semibold tabular-nums">15</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ==================================================================
   Footer
   ================================================================== */

function Footer() {
  return (
    <footer className="mt-16 border-t border-border py-6">
      <div className="mx-auto max-w-7xl px-6 flex items-center justify-between text-[11px] text-muted">
        <div>
          شبكة GPU — خفيفة، موحدة، تحت سيطرتك. <span className="text-muted">v1</span>
        </div>
        <div className="flex gap-4">
          <span>الرياض · السعودية</span>
          <span className="text-muted">·</span>
          <span>جميع الأجهزة تحت ملكية المستخدم</span>
        </div>
      </div>
    </footer>
  );
}

/* ==================================================================
   Phase: Login
   ================================================================== */

function LoadingView() {
  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-center mt-24">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-border border-t-accent rounded-full mx-auto animate-spin" />
          <p className="mt-4 text-xs text-muted">جاري التحقق من جلستك...</p>
        </div>
      </div>
    </main>
  );
}

function PendingApprovalView({ user }: { user: UserResponse }) {
  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-8">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-amber-500/15 border-2 border-amber-500/30 mb-5 text-3xl">
          ⏳
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">حسابك قيد المراجعة</h1>
        <p className="text-sm text-muted-hi leading-relaxed mb-5">
          تم إنشاء حسابك بنجاح وهو الآن في انتظار موافقة المشرف على الشبكة.
          ستتمكن من استئجار أو استضافة GPU بمجرد تفعيل الحساب.
        </p>
        <div className="rounded-md bg-surface-hi/40 border border-border p-3 text-xs text-muted space-y-1">
          <div className="flex justify-between">
            <span>البريد المسجل:</span>
            <span className="text-muted-hi font-mono" dir="ltr">{user.email}</span>
          </div>
          <div className="flex justify-between">
            <span>الحالة:</span>
            <span className="text-amber-800">{user.status === "suspended" ? "موقوف" : "بانتظار الموافقة"}</span>
          </div>
        </div>
        <p className="mt-5 text-[11px] text-muted">
          عند التفعيل، أعد تحميل الصفحة وسيظهر لك الاستئجار والاستضافة تلقائيا.
        </p>
      </div>
    </div>
  );
}

function LoginView({ onSuccess }: { onSuccess: (user: UserResponse) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const initialEmail = typeof window !== "undefined" ? getEmail() ?? "" : "";
  const [email, setLocalEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await apiFetch<UserResponse>("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }
      const tok = await apiFetch<TokenResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(tok.access_token);
      persistEmail(email);
      const me = await apiFetch<UserResponse>("/api/me");
      onSuccess(me);
    } catch (err) {
      const e = err as ApiError;
      setError(e?.detail || "حدث خطأ — حاول مرة أخرى");
      setBusy(false);
    }
  }

  const heading = mode === "signup" ? "إنشاء حساب جديد" : "تسجيل الدخول";
  const cta = busy
    ? mode === "signup"
      ? "جاري الإنشاء..."
      : "جاري الدخول..."
    : mode === "signup"
      ? "إنشاء الحساب ←"
      : "دخول ←";
  const subtitle =
    mode === "signup"
      ? "سجل لتبدأ في تأجير أو استضافة GPU من خلال الشبكة."
      : "استخدم حسابك للوصول إلى أجهزتك ولبدء استئجار GPU من الشبكة.";

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight leading-tight mb-3">
          شبكتك الخاصة من وحدات <span className="text-accent">GPU</span>
        </h1>
        <p className="text-sm text-muted-hi leading-relaxed max-w-sm mx-auto">
          اربط أجهزتك. شغل حاوياتك. راقب النتائج.
          <br />
          <span className="text-muted">لا سحابة. لا وسطاء. فقط شبكتك.</span>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-7 shadow-lg">
        <h2 className="text-lg font-semibold text-foreground mb-1">{heading}</h2>
        <p className="text-xs text-muted mb-6">{subtitle}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-hi mb-1.5 uppercase tracking-wide">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setLocalEmail(e.target.value)}
              required
              autoFocus
              dir="ltr"
              className="w-full rounded-lg border border-border-hi bg-surface-hi/60 px-4 py-2.5 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 transition-colors text-start"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-hi mb-1.5 uppercase tracking-wide">
              كلمة المرور {mode === "signup" && <span className="text-muted normal-case">(8 أحرف أو أكثر)</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : 1}
              className="w-full rounded-lg border border-border-hi bg-surface-hi/60 px-4 py-2.5 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 transition-colors"
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700" dir="ltr">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hi disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {cta}
          </button>
        </form>

        <div className="mt-5 pt-5 border-t border-border text-center text-xs text-muted">
          {mode === "login" ? (
            <>
              ليس لديك حساب؟{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); }}
                className="text-accent hover:text-accent font-medium"
              >
                إنشاء حساب جديد
              </button>
            </>
          ) : (
            <>
              لديك حساب بالفعل؟{" "}
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className="text-accent hover:text-accent font-medium"
              >
                تسجيل الدخول
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-[11px] text-muted mt-6">
        بالدخول أنت توافق على أن مهامك ستشغل على أجهزة الشبكة المختارة.
      </p>
    </div>
  );
}

/* ==================================================================
   Rent — Phase: Browse marketplace
   ================================================================== */

function RentBrowseView({ onPick }: { onPick: (g: NodeMarketplace) => void }) {
  const [nodes, setNodes] = useState<NodeMarketplace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NodeMarketplace[]>("/api/nodes/marketplace");
      setNodes(data);
      setError(null);
    } catch (err) {
      setError((err as ApiError)?.detail || "تعذر تحميل السوق");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const total = nodes?.length ?? 0;
  return (
    <div>
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">وحدات GPU متاحة للتأجير</h1>
          <p className="text-sm text-muted-hi mt-1.5 max-w-2xl leading-relaxed">
            هذه قائمة بالـ GPU التي يشاركها أعضاء آخرون في الشبكة. اختر واحدة واستخدمها
            لتشغيل مهمة تدريب أو استنتاج — ترسل المهمة مباشرة إلى جهاز المالك.
          </p>
        </div>
        <div className="text-xs text-muted tabular-nums">
          <span className="text-accent font-semibold">{total}</span> متصل الآن
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {nodes === null && !error && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          جاري تحميل السوق...
        </div>
      )}

      {nodes !== null && nodes.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border-hi bg-surface/30 p-10 text-center">
          <div className="text-4xl mb-3">🌙</div>
          <h3 className="text-base font-semibold text-foreground mb-2">لا توجد أجهزة متصلة الآن</h3>
          <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
            جميع أجهزة الشبكة في حالة غير متصلة حاليا. انتظر قليلا، أو شارك جهازك
            الخاص من تبويب «إضافة GPU للتأجير» لتملأ السوق بنفسك.
          </p>
        </div>
      )}

      {nodes !== null && nodes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((g) => (
            <RentableCard key={g.id} gpu={g} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function RentableCard({
  gpu,
  onPick,
}: {
  gpu: NodeMarketplace;
  onPick: (g: NodeMarketplace) => void;
}) {
  const available = gpu.status === "online";
  const initials = gpu.host_handle.replace(/^@/, "").slice(0, 2).toUpperCase();
  return (
    <div
      className={`group relative rounded-xl border p-5 transition-all ${
        available
          ? "border-border bg-surface/50 hover:border-accent/40 hover:bg-surface/70"
          : "border-border bg-surface/30 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 flex items-center justify-center text-[11px] font-bold text-foreground flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div
                className="font-bold text-foreground text-sm truncate"
                dir="ltr"
              >
                {gpu.host_handle}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted font-mono truncate" dir="ltr">
            {gpu.name}
          </div>
        </div>
        <StatusPill status={gpu.status} />
      </div>

      <div className="space-y-2 text-sm border-t border-border pt-4">
        <Row label="كرت الشاشة" value={gpu.gpu_model} mono />
        <Row label="ذاكرة الـ GPU" value={`${gpu.gpu_memory_gb} جيجابايت`} />
        <Row label="عدد وحدات الـ GPU" value={`${gpu.gpu_count}`} />
        <Row label="آخر نبضة" value={timeAgoAr(gpu.last_seen_at)} muted />
      </div>

      <button
        disabled={!available}
        onClick={() => onPick(gpu)}
        className="mt-5 w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white hover:bg-accent-hi disabled:bg-surface-hi disabled:text-muted disabled:cursor-not-allowed transition-colors"
      >
        {available
          ? "استئجار هذا الـ GPU ←"
          : `غير متاح (${translateStatus(gpu.status)})`}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted text-xs">{label}</span>
      <span
        className={`${mono ? "font-mono text-xs" : "text-sm"} ${
          muted ? "text-muted" : "text-foreground"
        }`}
        dir={mono ? "ltr" : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    online: "bg-accent-dim text-accent border-accent/30",
    offline: "bg-red-500/15 text-red-700 border-red-500/30",
    draining: "bg-amber-500/15 text-amber-800 border-amber-500/30",
  };
  const c = palette[status] ?? "bg-surface-hi text-muted-hi border-border-hi";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${c}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      {translateStatus(status)}
    </span>
  );
}

/* ==================================================================
   Rent — Phase: Submit job on someone else's GPU
   ================================================================== */

function RentSubmitView({
  gpu,
  image,
  setImage,
  command,
  setCommand,
  onBack,
  onStart,
}: {
  gpu: NodeMarketplace;
  image: string;
  setImage: (v: string) => void;
  command: string;
  setCommand: (v: string) => void;
  onBack: () => void;
  onStart: (jobId: string) => void;
}) {
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!command.trim()) {
      setError("الرجاء كتابة الأمر الذي سيشغل داخل الحاوية.");
      return;
    }
    setBusy(true);
    try {
      const job = await apiFetch<JobPublic>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          docker_image: image,
          command: ["bash", "-c", command],
          gpu_count: 1,
          max_duration_seconds: minutes * 60,
          preferred_node_id: gpu.id,
        }),
      });
      onStart(job.id);
    } catch (err) {
      const e = err as ApiError;
      if (e?.status === 402) {
        setError("رصيدك غير كاف لتشغيل هذه المهمة. تواصل مع المشرف لزيادة الرصيد.");
      } else if (e?.status === 422) {
        setError("صيغة الصورة أو الأمر غير صحيحة. راجع صيغة اسم الصورة (lowercase).");
      } else {
        setError(e?.detail || "فشل إرسال المهمة — حاول مرة أخرى");
      }
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="text-xs text-muted hover:text-muted-hi transition-colors mb-6"
      >
        → العودة إلى قائمة الـ GPU
      </button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2">تشغيل حاوية على GPU</h1>
        <div className="flex items-center gap-3 text-sm text-muted-hi flex-wrap">
          <span>على GPU:</span>
          <span className="inline-flex items-center gap-2 rounded-md bg-accent-dim border border-accent/20 px-2.5 py-1 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span dir="ltr">{gpu.host_handle}</span>
          </span>
          <span className="text-muted">·</span>
          <span className="font-mono text-xs" dir="ltr">
            {gpu.gpu_model}
          </span>
          <span className="text-muted">·</span>
          <span>{gpu.gpu_memory_gb} جيجا</span>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="rounded-xl border border-border bg-surface p-7 space-y-6"
      >
        <Field
          label="صورة Docker"
          hint="صورة عامة من Docker Hub. للاختبار السريع: nvidia/cuda:12.2.0-base-ubuntu22.04"
        >
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            required
            dir="ltr"
            className="font-mono text-sm w-full rounded-lg border border-border-hi bg-surface-hi/60 px-3.5 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 text-start"
          />
        </Field>

        <Field
          label="الأمر"
          hint='سيلف تلقائيا بـ bash -c "..." فيمكنك استخدام &&, ||, pipes, وعدة أسطر.'
        >
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            required
            rows={4}
            dir="ltr"
            placeholder="nvidia-smi"
            className="font-mono text-sm w-full rounded-lg border border-border-hi bg-surface-hi/60 px-3.5 py-2.5 text-foreground placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 text-start whitespace-pre"
          />
        </Field>

        <Field label="الحد الأقصى (بالدقائق)" hint="سيتم إيقاف المهمة إذا تجاوزت هذه المدة.">
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            required
            className="text-sm w-full rounded-lg border border-border-hi bg-surface-hi/60 px-3.5 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </Field>

        <div>
          <div className="text-xs font-medium text-muted-hi uppercase tracking-wide mb-1.5">
            الأمر الذي سينفذ فعليا داخل الحاوية
          </div>
          <pre
            dir="ltr"
            className="rounded-lg border border-border bg-surface-hi/40 p-3.5 text-[11px] text-accent font-mono overflow-x-auto whitespace-pre-wrap break-all text-start"
          >
{`docker run --rm --gpus all ${image} bash -c ${JSON.stringify(command || "")}`}
          </pre>
          <p className="mt-2 text-[11px] text-muted">
            أي مخرجات تريد حفظها يجب أن ترسلها من داخل الحاوية إلى تخزين خارجي (S3,
            GitHub, webhook). لا نحتفظ بأي ملفات بعد خروج الحاوية (ADR-003).
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gradient-to-br from-accent to-accent hover:from-accent-hi hover:to-accent-hi px-4 py-3.5 text-sm font-semibold text-white transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "جاري الإرسال..." : `🚀 ابدأ التنفيذ على GPU الخاص بـ ${gpu.host_handle}`}
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
      <label className="block text-xs font-medium text-muted-hi uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

/* ==================================================================
   Running view — the scripted progress demo
   ================================================================== */

function RunningView({
  gpu,
  image,
  jobId,
  onComplete,
  onCancel,
}: {
  gpu: NodeMarketplace;
  image: string;
  jobId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [job, setJob] = useState<JobPublic | null>(null);
  const [logs, setLogs] = useState<JobLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cursorRef = useRef<number>(-1);
  const stdoutRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<HTMLDivElement>(null);

  // Poll job status every 3s; exit to DoneView when terminal.
  useEffect(() => {
    let cancelled = false;
    async function pollJob() {
      try {
        const j = await apiFetch<JobPublic>(`/api/jobs/${jobId}`);
        if (cancelled) return;
        setJob(j);
        if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
          onComplete();
        }
      } catch (err) {
        if (!cancelled) setError((err as ApiError)?.detail || "فقد الاتصال بالمهمة");
      }
    }
    pollJob();
    const t = setInterval(pollJob, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobId, onComplete]);

  // Poll logs every 2s using after_sequence cursor.
  useEffect(() => {
    let cancelled = false;
    async function pollLogs() {
      try {
        const res = await apiFetch<JobLogListResponse>(
          `/api/jobs/${jobId}/logs?after_sequence=${cursorRef.current}&limit=500`,
        );
        if (cancelled || res.items.length === 0) return;
        setLogs((prev) => [...prev, ...res.items]);
        cursorRef.current = Math.max(
          cursorRef.current,
          ...res.items.map((l) => l.sequence),
        );
      } catch {
        /* swallow log errors; status poll surfaces any real failure */
      }
    }
    pollLogs();
    const t = setInterval(pollLogs, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobId]);

  async function doCancel() {
    setCancelling(true);
    try {
      await apiFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      onCancel();
    } catch (err) {
      setError((err as ApiError)?.detail || "فشل إلغاء المهمة");
      setCancelling(false);
    }
  }

  const stdoutLogs = useMemo(() => logs.filter((l) => l.stream !== "system"), [logs]);
  const systemLogs = useMemo(() => logs.filter((l) => l.stream === "system"), [logs]);

  useEffect(() => {
    if (stdoutRef.current) stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
    if (systemRef.current) systemRef.current.scrollTop = systemRef.current.scrollHeight;
  }, [logs.length]);

  const latestLoss = useMemo(() => {
    for (let i = stdoutLogs.length - 1; i >= 0; i--) {
      const m = stdoutLogs[i].content.match(/'loss':\s*([\d.]+)/);
      if (m) return m[1];
    }
    return "—";
  }, [stdoutLogs]);

  const status = job?.status ?? "queued";
  const elapsed = useMemo(() => {
    if (!job?.started_at) return 0;
    const end = job.completed_at ?? new Date().toISOString();
    return Math.max(0, (new Date(end).getTime() - new Date(job.started_at).getTime()) / 1000);
  }, [job]);

  const statusPillClass =
    status === "running"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-700"
      : status === "queued"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-800"
        : status === "completed"
          ? "border-accent/30 bg-accent-dim text-accent"
          : status === "failed"
            ? "border-red-500/30 bg-red-500/10 text-red-700"
            : "border-border-hi bg-surface-hi text-muted-hi";

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold tracking-tight">
              المهمة{" "}
              <span className="font-mono text-muted-hi text-lg" dir="ltr">
                #{jobId.slice(0, 8)}
              </span>
            </h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "running" || status === "queued" ? "animate-pulse" : ""}`} />
              {translateJobStatus(status)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-hi flex-wrap">
            <span>على GPU:</span>
            <span className="text-accent font-medium" dir="ltr">
              {gpu.host_handle}
            </span>
            <span className="text-muted">·</span>
            <span className="font-mono text-xs" dir="ltr">
              {gpu.gpu_model}
            </span>
            <span className="text-muted">·</span>
            <span className="font-mono text-xs text-muted" dir="ltr">
              {image}
            </span>
          </div>
        </div>
        <button
          onClick={doCancel}
          disabled={cancelling || status !== "queued" && status !== "running"}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-xs text-red-700 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {cancelling ? "جاري الإلغاء..." : "إلغاء المهمة"}
        </button>
      </div>

      {error && (
        <div className="mb-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface/50 p-6 mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm text-muted-hi font-medium">
            {status === "queued"
              ? "المهمة في الانتظار — بانتظار الوكيل ليستلمها..."
              : status === "running"
                ? "المهمة تعمل على جهاز المضيف"
                : `الحالة: ${translateJobStatus(status)}`}
          </div>
          <div className="text-xs tabular-nums text-muted" dir="ltr">
            {elapsed > 0 ? `${elapsed.toFixed(1)}s` : ""}
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-surface-hi overflow-hidden">
          <div
            className={`h-full ${
              status === "running"
                ? "bg-gradient-to-l from-accent-hi via-accent to-cat-amber animate-pulse w-full"
                : status === "completed"
                  ? "bg-accent w-full"
                  : status === "failed" || status === "cancelled"
                    ? "bg-red-500 w-full"
                    : "bg-surface-hi w-1/6"
            }`}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <HighlightCard label="الوقت المنقضي" value={elapsed > 0 ? `${elapsed.toFixed(1)} ث` : "—"} tone="info" />
        <HighlightCard label="آخر قيمة خسارة" value={latestLoss} tone="info" />
        <HighlightCard label="عدد الأسطر" value={String(logs.length)} tone="muted" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 h-[420px]">
        <LogPanel
          title="مخرجات الحاوية"
          subtitle="stdout و stderr من الحاوية"
          logs={stdoutLogs}
          emptyHint="في انتظار بدء الحاوية..."
          refProp={stdoutRef}
        />
        <LogPanel
          title="نشاط المنصة"
          subtitle="أحداث سحب الصورة، دورة حياة الحاوية، رسائل المجدول"
          logs={systemLogs}
          emptyHint="لم تبدأ المهمة بعد."
          refProp={systemRef}
          tintSystem
        />
      </div>
    </div>
  );
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
    ok: "text-accent",
    info: "text-sky-400",
    err: "text-red-700",
    muted: "text-muted-hi",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-mono font-semibold ${toneClass}`} dir="ltr">
        {value}
      </div>
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
  logs: JobLogEntry[];
  emptyHint: string;
  tintSystem?: boolean;
  refProp?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="terminal flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-[11px] text-muted mt-0.5">{subtitle}</div>
        </div>
        <span className="text-[11px] text-muted tabular-nums" dir="ltr">
          {logs.length} سطر
        </span>
      </div>
      <div
        ref={refProp}
        dir="ltr"
        className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-start"
      >
        {logs.length === 0 ? (
          <div className="text-muted text-xs" dir="rtl">
            {emptyHint}
          </div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={streamColor(l.stream)}>
              {tintSystem && l.stream === "system" && (
                <span className="text-sky-500/70 me-2">▸</span>
              )}
              <span className="text-muted me-2 tabular-nums">
                {String(i).padStart(3, "0")}
              </span>
              {l.content}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ==================================================================
   Done view
   ================================================================== */

function DoneView({
  gpu,
  image,
  jobId,
  onAgain,
  onHome,
}: {
  gpu: NodeMarketplace;
  image: string;
  jobId: string;
  onAgain: () => void;
  onHome: () => void;
}) {
  const [job, setJob] = useState<JobPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<JobPublic>(`/api/jobs/${jobId}`)
      .then(setJob)
      .catch((err) => setError((err as ApiError)?.detail || "تعذر تحميل تفاصيل المهمة"));
  }, [jobId]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-700 mb-4">{error}</p>
        <button
          onClick={onHome}
          className="rounded-lg bg-surface-hi hover:bg-surface-hi px-4 py-2 text-sm text-foreground"
        >
          العودة إلى قائمة الـ GPU
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        جاري تحميل ملخص المهمة...
      </div>
    );
  }

  const success = job.status === "completed" && job.exit_code === 0;
  const durationSeconds =
    job.started_at && job.completed_at
      ? (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000
      : null;

  const headlineClass = success
    ? "bg-accent-dim border-accent/40"
    : job.status === "cancelled"
      ? "bg-surface-hi border-border-hi"
      : "bg-red-500/15 border-red-500/40";
  const headlineIconClass = success
    ? "text-accent"
    : job.status === "cancelled"
      ? "text-muted-hi"
      : "text-red-700";
  const headline = success
    ? "اكتملت المهمة بنجاح"
    : job.status === "cancelled"
      ? "تم إلغاء المهمة"
      : "فشلت المهمة";
  const statusTone: HighlightTone = success ? "ok" : job.status === "cancelled" ? "muted" : "err";

  return (
    <div>
      <div className="text-center mb-8">
        <div className={`inline-flex items-center justify-center h-20 w-20 rounded-full border-2 mb-5 ${headlineClass}`}>
          {success ? (
            <svg className={`h-10 w-10 ${headlineIconClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : job.status === "cancelled" ? (
            <svg className={`h-10 w-10 ${headlineIconClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className={`h-10 w-10 ${headlineIconClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">{headline}</h1>
        <p className="text-sm text-muted-hi">
          تم التنفيذ على GPU التابع لـ{" "}
          <span className="text-accent font-mono" dir="ltr">
            {gpu.host_handle}
          </span>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 mb-5">
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-4">
          ملخص المهمة
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <SummaryRow label="رقم المهمة" value={`#${jobId.slice(0, 8)}`} mono />
          <SummaryRow label="الحالة" value={translateJobStatus(job.status)} tone={statusTone} />
          <SummaryRow label="مالك الـ GPU" value={gpu.host_handle} mono />
          <SummaryRow label="كرت الشاشة" value={gpu.gpu_model} mono />
          <SummaryRow
            label="المدة الفعلية"
            value={durationSeconds !== null ? `${durationSeconds.toFixed(1)} ثانية` : "—"}
            mono
          />
          <SummaryRow
            label="رمز الخروج"
            value={job.exit_code !== null ? String(job.exit_code) : "—"}
            mono
            tone={job.exit_code === 0 ? "ok" : job.exit_code === null ? "muted" : "err"}
          />
          <SummaryRow label="عدد GPUs" value={String(job.gpu_count)} />
          <SummaryRow label="الحاوية" value={image} mono />
        </div>
      </div>

      {job.error_message && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-5 mb-5">
          <div className="text-sm font-medium text-danger mb-2">رسالة الخطأ</div>
          <pre className="text-xs text-danger font-mono whitespace-pre-wrap break-all" dir="ltr">
            {job.error_message}
          </pre>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-accent/20 bg-accent-dim p-5 mb-8">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded bg-accent-dim text-accent flex items-center justify-center text-xs flex-shrink-0">
              ✓
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-accent">خرجت الحاوية برمز 0</div>
              <div className="text-xs text-accent/80 mt-1.5 leading-relaxed">
                أي ناتج أردت حفظه يجب أن تكون قد رفعته داخل الحاوية إلى تخزين خارجي
                (S3, GitHub, webhook). لا نحتفظ بأي ملفات بعد خروج الحاوية.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onAgain}
          className="rounded-lg bg-accent hover:bg-accent-hi px-4 py-3 text-sm font-semibold text-white transition-colors"
        >
          تشغيل مهمة جديدة على نفس الـ GPU
        </button>
        <button
          onClick={onHome}
          className="rounded-lg border border-border-hi bg-surface hover:bg-surface/70 px-4 py-3 text-sm font-medium text-muted-hi transition-colors"
        >
          العودة إلى قائمة الـ GPU
        </button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: HighlightTone;
  mono?: boolean;
}) {
  const toneClass = tone
    ? {
        ok: "text-accent",
        info: "text-sky-400",
        err: "text-red-700",
        muted: "text-muted-hi",
      }[tone]
    : "text-foreground";
  return (
    <div className="flex justify-between items-baseline border-b border-border/60 pb-2">
      <span className="text-muted text-xs">{label}</span>
      <span
        className={`${mono ? "font-mono text-xs" : "text-sm"} ${toneClass}`}
        dir={mono ? "ltr" : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/* ==================================================================
   My GPUs page (add-for-rent side)
   ================================================================== */

function MyGpusView({ onAddNew }: { onAddNew: () => void }) {
  const [nodes, setNodes] = useState<NodePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NodePublic[]>("/api/nodes");
      setNodes(data);
      setError(null);
    } catch (err) {
      setError((err as ApiError)?.detail || "تعذر تحميل قائمة أجهزتك");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const total = nodes?.length ?? 0;
  const onlineCount = nodes?.filter((g) => g.status === "online").length ?? 0;

  return (
    <div>
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">أجهزة GPU الخاصة بي</h1>
          <p className="text-sm text-muted-hi mt-1.5 max-w-2xl leading-relaxed">
            هذه هي الأجهزة التي سجلتها في الشبكة وأتحتها للتأجير لأعضاء آخرين. كل جهاز
            يعمل كمعالج GPU خفيف — يتصل بالشبكة، يستقبل المهام، وينفذها محليا.
          </p>
        </div>
        <button
          onClick={onAddNew}
          className="rounded-lg bg-accent hover:bg-accent-hi px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-accent/20 flex items-center gap-2"
        >
          <span className="text-lg">+</span>
          <span>إضافة GPU جديد</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <HighlightCard label="عدد أجهزتي" value={String(total)} tone="info" />
        <HighlightCard
          label="المتصلة الآن"
          value={total ? `${onlineCount} / ${total}` : "—"}
          tone="ok"
        />
        <HighlightCard
          label="حالة الجلب"
          value={error ? "خطأ" : nodes === null ? "جاري..." : "حديث"}
          tone={error ? "err" : nodes === null ? "muted" : "info"}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {nodes === null && !error && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          جاري تحميل قائمة أجهزتك...
        </div>
      )}

      {nodes !== null && nodes.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-accent/20 bg-accent-dim p-10 text-center">
          <div className="text-4xl mb-3">🖥️</div>
          <h3 className="text-base font-semibold text-foreground mb-2">لم تضف أي جهاز بعد</h3>
          <p className="text-xs text-muted-hi mb-5 max-w-sm mx-auto leading-relaxed">
            اضغط «إضافة GPU جديد» لتوليد رمز تسجيل وتشغيل الوكيل على جهازك. لا نخزن أي
            بيانات على الجهاز — فقط يتصل بالشبكة عند الحاجة.
          </p>
          <button
            onClick={onAddNew}
            className="rounded-lg bg-accent hover:bg-accent-hi px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            إضافة GPU جديد ←
          </button>
        </div>
      )}

      {nodes !== null && nodes.length > 0 && (
        <div className="space-y-3">
          {nodes.map((g) => (
            <MyGpuRow key={g.id} node={g} />
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-dashed border-border bg-surface p-5 flex items-start gap-4">
        <div className="h-9 w-9 rounded-md bg-accent-dim text-accent flex items-center justify-center text-lg flex-shrink-0">
          💡
        </div>
        <div className="flex-1">
          <div className="text-sm text-muted-hi font-medium">
            فكرة: أضف جهازا جديدا إلى شبكتك
          </div>
          <div className="text-xs text-muted mt-1.5 leading-relaxed">
            يمكنك إضافة أي جهاز يحتوي على كرت شاشة NVIDIA — لابتوبك، حاسوبك المنزلي،
            أو جهاز في عملك. اضغط <span className="text-accent">«إضافة GPU جديد»</span>{" "}
            لتوليد رمز التسجيل وأمر التشغيل.
          </div>
        </div>
      </div>
    </div>
  );
}

function MyGpuRow({ node }: { node: NodePublic }) {
  return (
    <div className="rounded-xl border border-border bg-surface/50 p-5 flex items-center gap-5">
      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-accent/30 to-cat-amber/30 flex items-center justify-center text-xl flex-shrink-0">
        🖥️
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1">
          <h3 className="font-bold text-foreground text-base">{node.name}</h3>
          <StatusPill status={node.status} />
        </div>
        <div className="flex gap-5 text-xs text-muted-hi flex-wrap mt-2">
          <span>
            <span className="text-muted">كرت: </span>
            <span className="font-mono text-muted-hi" dir="ltr">
              {node.gpu_model}
            </span>
          </span>
          <span>
            <span className="text-muted">ذاكرة: </span>
            <span className="text-muted-hi">{node.gpu_memory_gb} جيجا</span>
          </span>
          <span>
            <span className="text-muted">عدد GPUs: </span>
            <span className="text-muted-hi">{node.gpu_count}</span>
          </span>
          <span>
            <span className="text-muted">آخر نبضة: </span>
            <span className="text-muted-hi">{timeAgoAr(node.last_seen_at)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================
   Add GPU form
   ================================================================== */

function AddGpuFormView({
  name,
  setName,
  onBack,
  onSuccess,
}: {
  name: string;
  setName: (v: string) => void;
  onBack: () => void;
  onSuccess: (claim: ClaimTokenResponse) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const claim = await apiFetch<ClaimTokenResponse>(
        "/api/nodes/claim-tokens",
        { method: "POST" },
      );
      onSuccess(claim);
    } catch (err) {
      const e = err as ApiError;
      if (e?.status === 403) {
        setError(
          "حسابك غير مفعل لاستضافة GPU. تواصل مع المشرف لتفعيل صلاحية الاستضافة.",
        );
      } else {
        setError(e?.detail || "فشل إنشاء رمز التسجيل — حاول مرة أخرى");
      }
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <button
        onClick={onBack}
        className="text-xs text-muted hover:text-muted-hi transition-colors mb-6"
      >
        → العودة إلى أجهزتي
      </button>

      <h1 className="text-2xl font-bold tracking-tight mb-2">إضافة GPU جديد</h1>
      <p className="text-sm text-muted-hi mb-8 max-w-xl leading-relaxed">
        أعط جهازك اسما مختصرا يساعدك على التعرف عليه في لوحتك (ولن يراه أحد آخر في
        الشبكة). بعد الإنشاء سنولد لك رمز تسجيل وأمر تشغيل تنسخه إلى جهازك.
      </p>

      <form
        onSubmit={submit}
        className="rounded-xl border border-border bg-surface p-7 space-y-6"
      >
        <Field
          label="اسم الـ GPU"
          hint="أمثلة شائعة: لابتوبي، حاسوب المنزل، جهاز العمل، PC الألعاب."
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="مثلا: لابتوبي"
            className="text-sm w-full rounded-lg border border-border-hi bg-surface-hi/60 px-3.5 py-2.5 text-foreground placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </Field>

        <div className="rounded-lg border border-border bg-background/30 p-4 text-xs text-muted-hi leading-relaxed space-y-2">
          <div className="text-foreground font-semibold text-sm mb-1">ماذا سيحدث بعد ذلك؟</div>
          <div className="flex items-start gap-2">
            <span className="text-accent">1.</span>
            <span>سننشئ لك رمز تسجيل صالح لـ24 ساعة.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-accent">2.</span>
            <span>تقوم بتشغيل أمر بسيط على الجهاز الذي يحتوي على كرت NVIDIA.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-accent">3.</span>
            <span>الوكيل (agent) يتصل بالشبكة، ويظهر الجهاز في قائمتك تلقائيا.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-accent">4.</span>
            <span>يصبح متاحا للاستئجار من قبل مستخدمين آخرين.</span>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 leading-relaxed">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="w-full rounded-lg bg-gradient-to-br from-accent to-accent hover:from-accent-hi hover:to-accent-hi px-4 py-3.5 text-sm font-semibold text-white transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "جاري الإنشاء..." : "إنشاء رمز التسجيل ←"}
        </button>
      </form>
    </div>
  );
}

/* ==================================================================
   Add GPU — Success screen (shows install command)
   ================================================================== */

function copyToClipboard(text: string, onDone: () => void) {
  // Prefer the async clipboard API (requires HTTPS or localhost).
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => fallbackCopy(text, onDone));
    return;
  }
  fallbackCopy(text, onDone);
}

function fallbackCopy(text: string, onDone: () => void) {
  // Fallback for plain-HTTP origins where navigator.clipboard is undefined.
  if (typeof document === "undefined") return;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    onDone();
  } catch {
    /* give up silently; user can select + Cmd/Ctrl+C manually */
  }
  document.body.removeChild(ta);
}

function AddGpuSuccessView({
  name,
  claim,
  onDone,
}: {
  name: string;
  claim: ClaimTokenResponse;
  onDone: () => void;
}) {
  const claimTokenStr = claim.token;
  const controlPlane = useMemo(() => {
    const m = claim.install_command.match(/--control-plane=(\S+)/);
    return m ? m[1] : "http://34.18.164.66:8000";
  }, [claim.install_command]);

  const [os, setOs] = useState<"windows" | "linux" | "mac">("windows");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function handleCopy(text: string, key: string) {
    copyToClipboard(text, () => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 2000);
    });
  }

  const powershellCmd = `wsl --install -d Ubuntu`;

  const bashCmd = `# 1 — Install the agent (once per machine)
curl -fsSL ${controlPlane}/public/install.sh | sudo bash

# 2 — Register this machine with your claim token
sudo gpu-agent init \\
    --config=/etc/gpu-agent/config.json \\
    --control-plane=${controlPlane} \\
    --claim-token=${claimTokenStr} \\
    --name="${name}"

# 3 — Start the service (survives reboots)
sudo systemctl enable --now gpu-agent`;

  return (
    <div className="max-w-3xl">
      <div className="mb-7">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-dim px-3 py-1 text-[11px] font-medium text-accent mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          تم إنشاء رمز التسجيل
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          خطوة واحدة أخيرة: شغل الأوامر على «{name}»
        </h1>
        <p className="text-sm text-muted-hi max-w-xl leading-relaxed">
          اختر نظام التشغيل الذي يعمل عليه الجهاز الذي تريد إضافته.
        </p>
      </div>

      {/* OS tabs */}
      <div className="mb-5 inline-flex rounded-lg border border-border bg-surface p-1 gap-1">
        {([
          ["windows", "Windows"],
          ["linux", "Linux"],
          ["mac", "Mac"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setOs(key)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              os === key
                ? "bg-accent-dim text-accent border border-accent/30"
                : "text-muted-hi hover:text-foreground border border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {os === "mac" && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 mb-5">
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center text-lg flex-shrink-0">
              ⚠
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold text-amber-900 mb-2">
                أجهزة ماك لا يمكنها استضافة GPU
              </div>
              <div className="text-sm text-amber-800/90 leading-relaxed mb-3">
                أجهزة ماك الحديثة تستخدم كروت شاشة من Apple (معالج M1/M2/M3) ولا تحتوي
                على كرت NVIDIA. منصتنا تشغل الحاويات باستخدام{" "}
                <span className="font-mono" dir="ltr">docker run --gpus all</span> وهذا
                يتطلب كرت NVIDIA تحديدا.
              </div>
              <div className="text-sm text-amber-800/90 leading-relaxed">
                يمكنك بدلا من ذلك <span className="font-semibold text-accent">استئجار GPU</span>{" "}
                من الأعضاء الآخرين في الشبكة عبر التبويب الأيمن «استئجار GPU».
              </div>
            </div>
          </div>
        </div>
      )}

      {os === "windows" && (
        <>
          {/* Step 0: WSL install via PowerShell */}
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-sky-500/20 text-sky-700 text-[10px] font-bold">0</span>
            <h3 className="text-sm font-semibold text-foreground">
              تثبيت WSL (مرة واحدة فقط)
            </h3>
          </div>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            افتح <span className="font-mono text-muted-hi" dir="ltr">PowerShell</span>{" "}
            كمسؤول (Run as administrator)، ثم انسخ الأمر التالي. سيقوم Windows
            بتحميل Ubuntu وطلب إعادة التشغيل.
          </p>
          <CodeBlock
            language="powershell"
            code={powershellCmd}
            copied={copiedKey === "ps"}
            onCopy={() => handleCopy(powershellCmd, "ps")}
          />
          <p className="text-xs text-muted mt-3 mb-6 leading-relaxed">
            بعد إعادة التشغيل، ستفتح نافذة Ubuntu تلقائيا وستطلب منك اختيار اسم
            مستخدم وكلمة مرور (للينكس داخل WSL، منفصلة عن حساب Windows). بعدها،
            انتقل للخطوة التالية <span className="font-bold text-muted-hi">داخل نافذة Ubuntu</span> وليس PowerShell.
          </p>

          {/* Steps 1-3: bash inside WSL Ubuntu */}
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">1-3</span>
            <h3 className="text-sm font-semibold text-foreground">
              تثبيت الوكيل داخل Ubuntu
            </h3>
          </div>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            انسخ والصق الكتلة كاملة داخل نافذة Ubuntu terminal.
          </p>
          <CodeBlock
            language="bash"
            code={bashCmd}
            copied={copiedKey === "bash"}
            onCopy={() => handleCopy(bashCmd, "bash")}
          />
        </>
      )}

      {os === "linux" && (
        <>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            افتح terminal على جهاز Linux الذي يحتوي على كرت NVIDIA والصق الكتلة التالية.
            تأكد أن <span className="font-mono" dir="ltr">docker</span> و{" "}
            <span className="font-mono" dir="ltr">nvidia-container-toolkit</span>{" "}
            مثبتان، و <span className="font-mono" dir="ltr">nvidia-smi</span> يعمل.
          </p>
          <CodeBlock
            language="bash"
            code={bashCmd}
            copied={copiedKey === "bash"}
            onCopy={() => handleCopy(bashCmd, "bash")}
          />
        </>
      )}

      {/* Token warning (shown for windows + linux, hidden on mac) */}
      {os !== "mac" && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 mb-5 mt-6">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded bg-amber-500/20 text-amber-800 flex items-center justify-center text-xs flex-shrink-0 font-bold">
              !
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-800 mb-1">
                هذا الرمز يعرض مرة واحدة فقط
              </div>
              <div className="text-xs text-amber-700 leading-relaxed mb-3">
                احفظه الآن. لن نتمكن من إظهاره لك مرة أخرى. صلاحيته 24 ساعة ويستخدم مرة واحدة.
              </div>
              <code
                dir="ltr"
                className="block rounded-md bg-surface-hi/40 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-800 font-mono text-start break-all"
              >
                {claimTokenStr}
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Requirements — hidden on mac because they don't apply */}
      {os !== "mac" && (
        <div className="rounded-xl border border-border bg-surface p-5 mb-8">
          <div className="text-sm font-semibold text-foreground mb-3">متطلبات الجهاز</div>
          <ul className="space-y-2 text-xs text-muted-hi">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">✓</span>
              <span>كرت شاشة NVIDIA مع تعريفات محدثة (CUDA 12 أو أحدث).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">✓</span>
              <span>
                Docker مثبت، مع إضافة <span className="font-mono" dir="ltr">nvidia-container-toolkit</span>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">✓</span>
              <span>اتصال إنترنت خارج فقط (لا يتطلب فتح بورت — الجهاز يتصل بالشبكة).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">✓</span>
              <span>نظام Linux (أصلي) أو Windows مع WSL2.</span>
            </li>
          </ul>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full rounded-lg bg-accent hover:bg-accent-hi px-4 py-3 text-sm font-semibold text-white transition-colors"
      >
        {os === "mac"
          ? "العودة إلى قائمة أجهزتي"
          : `حسنا، سيظهر «${name}» في قائمتي بعد التشغيل`}
      </button>
    </div>
  );
}

function CodeBlock({
  language,
  code,
  copied,
  onCopy,
}: {
  language: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="terminal overflow-hidden mb-2">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="text-xs text-muted font-mono" dir="ltr">
          {language}
        </div>
        <button
          onClick={onCopy}
          className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
            copied
              ? "bg-accent-dim text-accent"
              : "bg-surface-hi text-muted-hi hover:bg-surface-hi"
          }`}
        >
          {copied ? "تم النسخ ✓" : "📋 نسخ"}
        </button>
      </div>
      <pre
        dir="ltr"
        className="p-4 text-xs text-accent font-mono overflow-x-auto text-start leading-relaxed whitespace-pre"
      >
        {code}
      </pre>
    </div>
  );
}

/* ==================================================================
   CLI install view
   ================================================================== */

function CliInstallView() {
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const controlPlane =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : "http://localhost:8000";

  const pipCmd =
    "pip install git+https://github.com/kmalarifi97/training-network-v2.git#subdirectory=cli";
  const keyForCmd = generatedKey ?? "<YOUR_KEY>";
  const authCmd = `gpunet auth set-key ${keyForCmd} --url ${controlPlane}`;
  const verifyCmd = "gpunet auth whoami";
  const skillCmd = "gpunet install skill";

  function handleCopy(text: string, key: string) {
    copyToClipboard(text, () => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 2000);
    });
  }

  async function generateKey() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ full_key: string; prefix: string }>(
        "/api/keys",
        {
          method: "POST",
          body: JSON.stringify({
            name: `cli-${new Date().toISOString().slice(0, 10)}`,
          }),
        },
      );
      setGeneratedKey(res.full_key);
    } catch (e) {
      const err = e as ApiError;
      setError(err.detail ?? "فشل إنشاء المفتاح");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight mb-2">سطر الأوامر</h1>
        <p className="text-sm text-muted-hi leading-relaxed">
          استخدم{" "}
          <span className="font-mono text-accent" dir="ltr">
            gpunet
          </span>{" "}
          من الترمنال لإرسال مهام GPU، تصفح الشبكة، وإدارة حسابك — بدون الحاجة لفتح
          المتصفح.
        </p>
      </div>

      {/* Step 1: pip install */}
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
          1
        </span>
        <h3 className="text-sm font-semibold text-foreground">
          ثبت الأداة (يتطلب Python 3.10+)
        </h3>
      </div>
      <CodeBlock
        language="bash"
        code={pipCmd}
        copied={copiedKey === "pip"}
        onCopy={() => handleCopy(pipCmd, "pip")}
      />

      {/* Step 2: generate API key */}
      <div className="mt-6 mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
          2
        </span>
        <h3 className="text-sm font-semibold text-foreground">أنشئ مفتاح API</h3>
      </div>
      <p className="text-xs text-muted mb-3 leading-relaxed">
        سيعرض المفتاح الكامل مرة واحدة فقط. انسخه فورا إلى مكان آمن.
      </p>

      {!generatedKey ? (
        <button
          onClick={generateKey}
          disabled={busy}
          className="rounded-lg bg-accent hover:bg-accent-hi px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "جاري الإنشاء..." : "إنشاء مفتاح جديد"}
        </button>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 mb-2">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded bg-amber-500/20 text-amber-800 flex items-center justify-center text-xs flex-shrink-0 font-bold">
              !
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-amber-800 mb-1">
                هذا المفتاح يعرض مرة واحدة فقط
              </div>
              <div className="text-xs text-amber-700 leading-relaxed mb-3">
                احفظه الآن. لن نتمكن من إظهاره لك مرة أخرى.
              </div>
              <code
                dir="ltr"
                className="block rounded-md bg-surface-hi/40 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-800 font-mono text-start break-all"
              >
                {generatedKey}
              </code>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Step 3: auth set-key */}
      <div className="mt-6 mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
          3
        </span>
        <h3 className="text-sm font-semibold text-foreground">اربط الأداة بحسابك</h3>
      </div>
      <CodeBlock
        language="bash"
        code={authCmd}
        copied={copiedKey === "auth"}
        onCopy={() => handleCopy(authCmd, "auth")}
      />

      {/* Step 4: verify */}
      <div className="mt-6 mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
          4
        </span>
        <h3 className="text-sm font-semibold text-foreground">تحقق من الاتصال</h3>
      </div>
      <CodeBlock
        language="bash"
        code={verifyCmd}
        copied={copiedKey === "verify"}
        onCopy={() => handleCopy(verifyCmd, "verify")}
      />

      {/* Optional: skill install */}
      <div className="mt-8 rounded-xl border border-border bg-surface p-5">
        <div className="text-sm font-semibold text-foreground mb-2">
          للوكلاء البرمجيين (اختياري)
        </div>
        <p className="text-xs text-muted mb-3 leading-relaxed">
          إذا كنت تستخدم{" "}
          <span className="font-mono text-muted-hi" dir="ltr">
            Claude Code
          </span>{" "}
          أو وكيلا مشابها، ثبت المهارة ليكتشف المنصة تلقائيا:
        </p>
        <CodeBlock
          language="bash"
          code={skillCmd}
          copied={copiedKey === "skill"}
          onCopy={() => handleCopy(skillCmd, "skill")}
        />
      </div>
    </div>
  );
}
