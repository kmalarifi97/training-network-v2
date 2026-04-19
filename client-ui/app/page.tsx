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

const DEFAULT_IMAGE = "kmalarifi/llm-finetune:v1";
const DEFAULT_REPO = "https://github.com/kmalarifi/finetune-demo";

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
  | "add_gpu_success";

/* Which sidebar section each phase belongs to. */
function sidebarSection(p: Phase): "rent" | "host" | null {
  if (p === "login" || p === "loading" || p === "pending_approval") return null;
  if (p.startsWith("rent_")) return "rent";
  return "host";
}

function streamColor(s: "stdout" | "stderr" | "system"): string {
  if (s === "stdout") return "text-zinc-100";
  if (s === "stderr") return "text-amber-300";
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
  if (!iso) return "لم يتّصل بعد";
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
  const [repo, setRepo] = useState(DEFAULT_REPO);
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
    <div className="min-h-screen bg-[#050507] text-zinc-100">
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
                repo={repo}
                setRepo={setRepo}
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
        : "";

  return (
    <header className="relative border-b border-zinc-900 bg-[#050507]/90 backdrop-blur-sm sticky top-0 z-10">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-black text-sm">
              ش
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight">
                شبكة <span className="text-emerald-400">GPU</span>
              </div>
              <div className="text-[10px] text-zinc-500 tracking-wide">
                شبكة خفيفة · أجهزتك · تحت سيطرتك
              </div>
            </div>
          </div>
          {sectionLabel && (
            <>
              <span className="text-zinc-800">|</span>
              <div className="text-sm text-zinc-300">{sectionLabel}</div>
            </>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-xs text-zinc-300">{handleFromEmail(user.email)}</div>
              <div className="text-[10px] text-zinc-600" dir="ltr">{user.email}</div>
              <div className="text-[10px] text-emerald-400 tabular-nums" dir="ltr">
                {user.credits_gpu_hours} GPU-ساعة
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
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
      hint: "شغّل مهامك على جهاز شخص آخر",
      icon: "⚡",
      target: "rent_browse" as Phase,
    },
  ];

  return (
    <aside className="w-64 flex-shrink-0">
      <div className="sticky top-24">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
          {items.map((it) => {
            const active = sec === it.section;
            return (
              <button
                key={it.section}
                onClick={() => onNavigate(it.target)}
                className={`w-full text-right rounded-lg p-3 transition-colors group ${
                  active
                    ? "bg-emerald-500/10 border border-emerald-500/30"
                    : "hover:bg-zinc-800/60 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`h-7 w-7 rounded-md flex items-center justify-center text-sm flex-shrink-0 ${
                      active
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    {it.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-medium ${
                        active ? "text-emerald-300" : "text-zinc-200"
                      }`}
                    >
                      {it.label}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 leading-tight">
                      {it.hint}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* small stats panel at the bottom */}
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">
            حالة شبكتك
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">أجهزتي المتصلة</span>
              <span className="text-emerald-400 font-semibold">2 / 2</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">أجهزة متاحة للتأجير</span>
              <span className="text-zinc-200 font-semibold">4</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">ساعات GPU مُجمَّعة</span>
              <span className="text-zinc-200 font-semibold tabular-nums">15</span>
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
    <footer className="mt-16 border-t border-zinc-900 py-6">
      <div className="mx-auto max-w-7xl px-6 flex items-center justify-between text-[11px] text-zinc-600">
        <div>
          شبكة GPU — خفيفة، موحّدة، تحت سيطرتك. <span className="text-zinc-700">v1</span>
        </div>
        <div className="flex gap-4">
          <span>الرياض · السعودية</span>
          <span className="text-zinc-800">·</span>
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
          <div className="h-10 w-10 border-4 border-zinc-800 border-t-emerald-400 rounded-full mx-auto animate-spin" />
          <p className="mt-4 text-xs text-zinc-500">جاري التحقّق من جلستك...</p>
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
        <p className="text-sm text-zinc-400 leading-relaxed mb-5">
          تم إنشاء حسابك بنجاح وهو الآن في انتظار موافقة المشرف على الشبكة.
          ستتمكّن من استئجار أو استضافة GPU بمجرد تفعيل الحساب.
        </p>
        <div className="rounded-md bg-black/40 border border-zinc-800 p-3 text-xs text-zinc-500 space-y-1">
          <div className="flex justify-between">
            <span>البريد المسجّل:</span>
            <span className="text-zinc-300 font-mono" dir="ltr">{user.email}</span>
          </div>
          <div className="flex justify-between">
            <span>الحالة:</span>
            <span className="text-amber-300">{user.status === "suspended" ? "موقوف" : "بانتظار الموافقة"}</span>
          </div>
        </div>
        <p className="mt-5 text-[11px] text-zinc-600">
          عند التفعيل، أعد تحميل الصفحة وسيظهر لك الاستئجار والاستضافة تلقائياً.
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
      setError(e?.detail || "حدث خطأ — حاول مرّة أخرى");
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
      ? "سجّل لتبدأ في تأجير أو استضافة GPU من خلال الشبكة."
      : "استخدم حسابك للوصول إلى أجهزتك ولبدء استئجار GPU من الشبكة.";

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight leading-tight mb-3">
          شبكتك الخاصة من وحدات <span className="text-emerald-400">GPU</span>
        </h1>
        <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
          اربط أجهزتك. شغّل حاوياتك. راقب النتائج.
          <br />
          <span className="text-zinc-500">لا سحابة. لا وسطاء. فقط شبكتك.</span>
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-lg">
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">{heading}</h2>
        <p className="text-xs text-zinc-500 mb-6">{subtitle}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setLocalEmail(e.target.value)}
              required
              autoFocus
              dir="ltr"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors text-start"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
              كلمة المرور {mode === "signup" && <span className="text-zinc-600 normal-case">(8 أحرف أو أكثر)</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : 1}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors"
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" dir="ltr">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {cta}
          </button>
        </form>

        <div className="mt-5 pt-5 border-t border-zinc-800 text-center text-xs text-zinc-500">
          {mode === "login" ? (
            <>
              ليس لديك حساب؟{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); }}
                className="text-emerald-400 hover:text-emerald-300 font-medium"
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
                className="text-emerald-400 hover:text-emerald-300 font-medium"
              >
                تسجيل الدخول
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-[11px] text-zinc-600 mt-6">
        بالدخول أنت توافق على أن مهامك ستُشغَّل على أجهزة الشبكة المختارة.
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
      setError((err as ApiError)?.detail || "تعذّر تحميل السوق");
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
          <p className="text-sm text-zinc-400 mt-1.5 max-w-2xl leading-relaxed">
            هذه قائمة بالـ GPU التي يشاركها أعضاء آخرون في الشبكة. اختر واحدة واستخدمها
            لتشغيل مهمة تدريب أو استنتاج — تُرسَل المهمة مباشرة إلى جهاز المالك.
          </p>
        </div>
        <div className="text-xs text-zinc-500 tabular-nums">
          <span className="text-emerald-400 font-semibold">{total}</span> متصل الآن
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {nodes === null && !error && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          جاري تحميل السوق...
        </div>
      )}

      {nodes !== null && nodes.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 p-10 text-center">
          <div className="text-4xl mb-3">🌙</div>
          <h3 className="text-base font-semibold text-zinc-200 mb-2">لا توجد أجهزة متصلة الآن</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
            جميع أجهزة الشبكة في حالة غير متصلة حالياً. انتظر قليلاً، أو شارك جهازك
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
          ? "border-zinc-800 bg-zinc-900/50 hover:border-emerald-500/40 hover:bg-zinc-900/70"
          : "border-zinc-800 bg-zinc-900/30 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 flex items-center justify-center text-[11px] font-bold text-zinc-100 flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div
                className="font-bold text-zinc-100 text-sm truncate"
                dir="ltr"
              >
                {gpu.host_handle}
              </div>
            </div>
          </div>
          <div className="text-xs text-zinc-500 font-mono truncate" dir="ltr">
            {gpu.name}
          </div>
        </div>
        <StatusPill status={gpu.status} />
      </div>

      <div className="space-y-2 text-sm border-t border-zinc-800 pt-4">
        <Row label="كرت الشاشة" value={gpu.gpu_model} mono />
        <Row label="ذاكرة الـ GPU" value={`${gpu.gpu_memory_gb} جيجابايت`} />
        <Row label="عدد وحدات الـ GPU" value={`${gpu.gpu_count}`} />
        <Row label="آخر نبضة" value={timeAgoAr(gpu.last_seen_at)} muted />
      </div>

      <button
        disabled={!available}
        onClick={() => onPick(gpu)}
        className="mt-5 w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors"
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
      <span className="text-zinc-500 text-xs">{label}</span>
      <span
        className={`${mono ? "font-mono text-xs" : "text-sm"} ${
          muted ? "text-zinc-500" : "text-zinc-200"
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
    online: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    offline: "bg-red-500/15 text-red-300 border-red-500/30",
    draining: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };
  const c = palette[status] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
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
  repo,
  setRepo,
  onBack,
  onStart,
}: {
  gpu: NodeMarketplace;
  image: string;
  setImage: (v: string) => void;
  repo: string;
  setRepo: (v: string) => void;
  onBack: () => void;
  onStart: (jobId: string) => void;
}) {
  const [epochs, setEpochs] = useState(3);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shellCmd = useMemo(
    () =>
      `git clone --depth 1 ${repo} repo && cd repo && python3 train.py --epochs ${epochs}`,
    [repo, epochs],
  );
  const cmdPreview = `bash -c "${shellCmd}"`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const job = await apiFetch<JobPublic>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          docker_image: image,
          command: ["bash", "-c", shellCmd],
          gpu_count: 1,
          max_duration_seconds: minutes * 60,
          preferred_node_id: gpu.id,
        }),
      });
      onStart(job.id);
    } catch (err) {
      const e = err as ApiError;
      if (e?.status === 402) {
        setError("رصيدك غير كافٍ لتشغيل هذه المهمة. تواصل مع المشرف لزيادة الرصيد.");
      } else if (e?.status === 422) {
        setError("صيغة الصورة أو الأمر غير صحيحة. راجع صيغة اسم الصورة (lowercase).");
      } else {
        setError(e?.detail || "فشل إرسال المهمة — حاول مرّة أخرى");
      }
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        → العودة إلى قائمة الـ GPU
      </button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2">تشغيل مهمة تدريب</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-400 flex-wrap">
          <span>على GPU:</span>
          <span className="inline-flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span dir="ltr">{gpu.host_handle}</span>
          </span>
          <span className="text-zinc-600">·</span>
          <span className="font-mono text-xs" dir="ltr">
            {gpu.gpu_model}
          </span>
          <span className="text-zinc-600">·</span>
          <span>{gpu.gpu_memory_gb} جيجا</span>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-7 space-y-6"
      >
        <Field
          label="صورة Docker"
          hint="صورة عامة من Docker Hub — البيئة (PyTorch, CUDA)، وليست الكود."
        >
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            required
            dir="ltr"
            className="font-mono text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 text-start"
          />
        </Field>

        <Field
          label="رابط مستودع GitHub"
          hint="يُستنسخ في بداية كل مهمة. يجب أن يحتوي على train.py و data/train.csv."
        >
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            required
            dir="ltr"
            className="font-mono text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 text-start"
          />
        </Field>

        <div className="grid grid-cols-2 gap-5">
          <Field label="عدد الحقبات (Epochs)" hint="كم مرّة يمرّ النموذج على بيانات التدريب.">
            <input
              type="number"
              min={1}
              max={50}
              value={epochs}
              onChange={(e) => setEpochs(Number(e.target.value))}
              required
              className="text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
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
              className="text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </Field>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1.5">
            الأمر الذي سينفَّذ داخل الحاوية
          </div>
          <pre
            dir="ltr"
            className="rounded-lg border border-zinc-800 bg-black/40 p-3.5 text-[11px] text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap break-all text-start"
          >
            {cmdPreview}
          </pre>
          <p className="mt-2 text-[11px] text-zinc-600">
            ستتلقّى لقطة مباشرة لكل خطوة: سحب الصورة، بدء الحاوية، تدريب النموذج، حفظ الخرج.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 px-4 py-3.5 text-sm font-semibold text-white transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-zinc-600 leading-relaxed">{hint}</p>}
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
      ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
      : status === "queued"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : status === "completed"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : status === "failed"
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold tracking-tight">
              المهمة{" "}
              <span className="font-mono text-zinc-400 text-lg" dir="ltr">
                #{jobId.slice(0, 8)}
              </span>
            </h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "running" || status === "queued" ? "animate-pulse" : ""}`} />
              {translateJobStatus(status)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-400 flex-wrap">
            <span>على GPU:</span>
            <span className="text-emerald-400 font-medium" dir="ltr">
              {gpu.host_handle}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-xs" dir="ltr">
              {gpu.gpu_model}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-xs text-zinc-500" dir="ltr">
              {image}
            </span>
          </div>
        </div>
        <button
          onClick={doCancel}
          disabled={cancelling || status !== "queued" && status !== "running"}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {cancelling ? "جاري الإلغاء..." : "إلغاء المهمة"}
        </button>
      </div>

      {error && (
        <div className="mb-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm text-zinc-300 font-medium">
            {status === "queued"
              ? "المهمة في الانتظار — بانتظار الوكيل ليستلمها..."
              : status === "running"
                ? "المهمة تعمل على جهاز المضيف"
                : `الحالة: ${translateJobStatus(status)}`}
          </div>
          <div className="text-xs tabular-nums text-zinc-500" dir="ltr">
            {elapsed > 0 ? `${elapsed.toFixed(1)}s` : ""}
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full ${
              status === "running"
                ? "bg-gradient-to-l from-emerald-400 via-emerald-500 to-cyan-500 animate-pulse w-full"
                : status === "completed"
                  ? "bg-emerald-500 w-full"
                  : status === "failed" || status === "cancelled"
                    ? "bg-red-500 w-full"
                    : "bg-zinc-700 w-1/6"
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
    ok: "text-emerald-400",
    info: "text-sky-400",
    err: "text-red-400",
    muted: "text-zinc-400",
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-[11px] text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
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
    <div className="rounded-xl border border-zinc-800 bg-black/50 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</div>
        </div>
        <span className="text-[11px] text-zinc-600 tabular-nums" dir="ltr">
          {logs.length} سطر
        </span>
      </div>
      <div
        ref={refProp}
        dir="ltr"
        className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-start"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600 text-xs" dir="rtl">
            {emptyHint}
          </div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={streamColor(l.stream)}>
              {tintSystem && l.stream === "system" && (
                <span className="text-sky-500/70 me-2">▸</span>
              )}
              <span className="text-zinc-600 me-2 tabular-nums">
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
      .catch((err) => setError((err as ApiError)?.detail || "تعذّر تحميل تفاصيل المهمة"));
  }, [jobId]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-300 mb-4">{error}</p>
        <button
          onClick={onHome}
          className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-200"
        >
          العودة إلى قائمة الـ GPU
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
        جاري تحميل ملخّص المهمة...
      </div>
    );
  }

  const success = job.status === "completed" && job.exit_code === 0;
  const durationSeconds =
    job.started_at && job.completed_at
      ? (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000
      : null;

  const headlineClass = success
    ? "bg-emerald-500/15 border-emerald-500/40"
    : job.status === "cancelled"
      ? "bg-zinc-500/15 border-zinc-500/40"
      : "bg-red-500/15 border-red-500/40";
  const headlineIconClass = success
    ? "text-emerald-400"
    : job.status === "cancelled"
      ? "text-zinc-300"
      : "text-red-400";
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
        <p className="text-sm text-zinc-400">
          تم التنفيذ على GPU التابع لـ{" "}
          <span className="text-emerald-400 font-mono" dir="ltr">
            {gpu.host_handle}
          </span>
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 mb-5">
        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-4">
          ملخّص المهمة
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
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 mb-5">
          <div className="text-sm font-medium text-red-200 mb-2">رسالة الخطأ</div>
          <pre className="text-xs text-red-300/90 font-mono whitespace-pre-wrap break-all" dir="ltr">
            {job.error_message}
          </pre>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 mb-8">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-xs flex-shrink-0">
              ✓
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-200">خرجت الحاوية برمز 0</div>
              <div className="text-xs text-emerald-400/80 mt-1.5 leading-relaxed">
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
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
        >
          تشغيل مهمة جديدة على نفس الـ GPU
        </button>
        <button
          onClick={onHome}
          className="rounded-lg border border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/70 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors"
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
        ok: "text-emerald-400",
        info: "text-sky-400",
        err: "text-red-400",
        muted: "text-zinc-400",
      }[tone]
    : "text-zinc-100";
  return (
    <div className="flex justify-between items-baseline border-b border-zinc-800/60 pb-2">
      <span className="text-zinc-500 text-xs">{label}</span>
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
      setError((err as ApiError)?.detail || "تعذّر تحميل قائمة أجهزتك");
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
          <p className="text-sm text-zinc-400 mt-1.5 max-w-2xl leading-relaxed">
            هذه هي الأجهزة التي سجّلتها في الشبكة وأتحتها للتأجير لأعضاء آخرين. كل جهاز
            يعمل كعقدة GPU خفيفة — يتصل بالشبكة، يستقبل المهام، وينفّذها محلياً.
          </p>
        </div>
        <button
          onClick={onAddNew}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-emerald-500/20 flex items-center gap-2"
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
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {nodes === null && !error && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          جاري تحميل قائمة أجهزتك...
        </div>
      )}

      {nodes !== null && nodes.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
          <div className="text-4xl mb-3">🖥️</div>
          <h3 className="text-base font-semibold text-zinc-100 mb-2">لم تضف أي جهاز بعد</h3>
          <p className="text-xs text-zinc-400 mb-5 max-w-sm mx-auto leading-relaxed">
            اضغط «إضافة GPU جديد» لتوليد رمز تسجيل وتشغيل الوكيل على جهازك. لا نخزّن أي
            بيانات على الجهاز — فقط يتصل بالشبكة عند الحاجة.
          </p>
          <button
            onClick={onAddNew}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
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

      <div className="mt-8 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-5 flex items-start gap-4">
        <div className="h-9 w-9 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-lg flex-shrink-0">
          💡
        </div>
        <div className="flex-1">
          <div className="text-sm text-zinc-300 font-medium">
            فكرة: أضف جهازاً جديداً إلى شبكتك
          </div>
          <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
            يمكنك إضافة أي جهاز يحتوي على كرت شاشة NVIDIA — لابتوبك، حاسوبك المنزلي،
            أو جهاز في عملك. اضغط <span className="text-emerald-400">«إضافة GPU جديد»</span>{" "}
            لتوليد رمز التسجيل وأمر التشغيل.
          </div>
        </div>
      </div>
    </div>
  );
}

function MyGpuRow({ node }: { node: NodePublic }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex items-center gap-5">
      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center text-xl flex-shrink-0">
        🖥️
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1">
          <h3 className="font-bold text-zinc-100 text-base">{node.name}</h3>
          <StatusPill status={node.status} />
        </div>
        <div className="flex gap-5 text-xs text-zinc-400 flex-wrap mt-2">
          <span>
            <span className="text-zinc-600">كرت: </span>
            <span className="font-mono text-zinc-300" dir="ltr">
              {node.gpu_model}
            </span>
          </span>
          <span>
            <span className="text-zinc-600">ذاكرة: </span>
            <span className="text-zinc-300">{node.gpu_memory_gb} جيجا</span>
          </span>
          <span>
            <span className="text-zinc-600">عدد GPUs: </span>
            <span className="text-zinc-300">{node.gpu_count}</span>
          </span>
          <span>
            <span className="text-zinc-600">آخر نبضة: </span>
            <span className="text-zinc-400">{timeAgoAr(node.last_seen_at)}</span>
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
          "حسابك غير مفعّل لاستضافة GPU. تواصل مع المشرف لتفعيل صلاحية الاستضافة.",
        );
      } else {
        setError(e?.detail || "فشل إنشاء رمز التسجيل — حاول مرّة أخرى");
      }
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <button
        onClick={onBack}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        → العودة إلى أجهزتي
      </button>

      <h1 className="text-2xl font-bold tracking-tight mb-2">إضافة GPU جديد</h1>
      <p className="text-sm text-zinc-400 mb-8 max-w-xl leading-relaxed">
        أعطِ جهازك اسماً مختصراً يساعدك على التعرّف عليه في لوحتك (ولن يراه أحد آخر في
        الشبكة). بعد الإنشاء سنولّد لك رمز تسجيل وأمر تشغيل تنسخه إلى جهازك.
      </p>

      <form
        onSubmit={submit}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-7 space-y-6"
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
            placeholder="مثلاً: لابتوبي"
            className="text-sm w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </Field>

        <div className="rounded-lg border border-zinc-800 bg-black/30 p-4 text-xs text-zinc-400 leading-relaxed space-y-2">
          <div className="text-zinc-200 font-semibold text-sm mb-1">ماذا سيحدث بعد ذلك؟</div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">1.</span>
            <span>سنُنشئ لك رمز تسجيل صالح لـ24 ساعة.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">2.</span>
            <span>تقوم بتشغيل أمر بسيط على الجهاز الذي يحتوي على كرت NVIDIA.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">3.</span>
            <span>الوكيل (agent) يتصل بالشبكة، ويظهر الجهاز في قائمتك تلقائياً.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">4.</span>
            <span>يصبح متاحاً للاستئجار من قبل مستخدمين آخرين.</span>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="w-full rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 px-4 py-3.5 text-sm font-semibold text-white transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          تم إنشاء رمز التسجيل
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          خطوة واحدة أخيرة: شغّل الأوامر على «{name}»
        </h1>
        <p className="text-sm text-zinc-400 max-w-xl leading-relaxed">
          اختر نظام التشغيل الذي يعمل عليه الجهاز الذي تريد إضافته.
        </p>
      </div>

      {/* OS tabs */}
      <div className="mb-5 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 p-1 gap-1">
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
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "text-zinc-400 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {os === "mac" && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 mb-5">
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center text-lg flex-shrink-0">
              ⚠
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold text-amber-100 mb-2">
                أجهزة ماك لا يمكنها استضافة GPU
              </div>
              <div className="text-sm text-amber-200/90 leading-relaxed mb-3">
                أجهزة ماك الحديثة تستخدم كروت شاشة من Apple (معالج M1/M2/M3) ولا تحتوي
                على كرت NVIDIA. منصّتنا تشغّل الحاويات باستخدام{" "}
                <span className="font-mono" dir="ltr">docker run --gpus all</span> وهذا
                يتطلّب كرت NVIDIA تحديداً.
              </div>
              <div className="text-sm text-amber-200/90 leading-relaxed">
                يمكنك بدلاً من ذلك <span className="font-semibold text-emerald-300">استئجار GPU</span>{" "}
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
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold">0</span>
            <h3 className="text-sm font-semibold text-zinc-200">
              تثبيت WSL (مرة واحدة فقط)
            </h3>
          </div>
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            افتح <span className="font-mono text-zinc-300" dir="ltr">PowerShell</span>{" "}
            كمسؤول (Run as administrator)، ثم انسخ الأمر التالي. سيقوم Windows
            بتحميل Ubuntu وطلب إعادة التشغيل.
          </p>
          <CodeBlock
            language="powershell"
            code={powershellCmd}
            copied={copiedKey === "ps"}
            onCopy={() => handleCopy(powershellCmd, "ps")}
          />
          <p className="text-xs text-zinc-500 mt-3 mb-6 leading-relaxed">
            بعد إعادة التشغيل، ستفتح نافذة Ubuntu تلقائياً وستطلب منك اختيار اسم
            مستخدم وكلمة مرور (للينكس داخل WSL، منفصلة عن حساب Windows). بعدها،
            انتقل للخطوة التالية <span className="font-bold text-zinc-300">داخل نافذة Ubuntu</span> وليس PowerShell.
          </p>

          {/* Steps 1-3: bash inside WSL Ubuntu */}
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">1-3</span>
            <h3 className="text-sm font-semibold text-zinc-200">
              تثبيت الوكيل داخل Ubuntu
            </h3>
          </div>
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
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
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            افتح terminal على جهاز Linux الذي يحتوي على كرت NVIDIA والصق الكتلة التالية.
            تأكّد أنّ <span className="font-mono" dir="ltr">docker</span> و{" "}
            <span className="font-mono" dir="ltr">nvidia-container-toolkit</span>{" "}
            مثبَّتان، و <span className="font-mono" dir="ltr">nvidia-smi</span> يعمل.
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
            <div className="h-6 w-6 rounded bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs flex-shrink-0 font-bold">
              !
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-200 mb-1">
                هذا الرمز يُعرض مرّة واحدة فقط
              </div>
              <div className="text-xs text-amber-400/80 leading-relaxed mb-3">
                احفظه الآن. لن نتمكّن من إظهاره لك مرة أخرى. صلاحيته 24 ساعة ويُستخدم مرّة واحدة.
              </div>
              <code
                dir="ltr"
                className="block rounded-md bg-black/40 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-200 font-mono text-start break-all"
              >
                {claimTokenStr}
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Requirements — hidden on mac because they don't apply */}
      {os !== "mac" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 mb-8">
          <div className="text-sm font-semibold text-zinc-200 mb-3">متطلبات الجهاز</div>
          <ul className="space-y-2 text-xs text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              <span>كرت شاشة NVIDIA مع تعريفات مُحدَّثة (CUDA 12 أو أحدث).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              <span>
                Docker مثبَّت، مع إضافة <span className="font-mono" dir="ltr">nvidia-container-toolkit</span>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              <span>اتصال إنترنت خارج فقط (لا يتطلّب فتح بورت — الجهاز يتصل بالشبكة).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              <span>نظام Linux (أصلي) أو Windows مع WSL2.</span>
            </li>
          </ul>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
      >
        {os === "mac"
          ? "العودة إلى قائمة أجهزتي"
          : `حسناً، سيظهر «${name}» في قائمتي بعد التشغيل`}
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
    <div className="rounded-xl border border-zinc-800 bg-black/50 overflow-hidden mb-2">
      <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
        <div className="text-xs text-zinc-500 font-mono" dir="ltr">
          {language}
        </div>
        <button
          onClick={onCopy}
          className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
            copied
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          {copied ? "تم النسخ ✓" : "📋 نسخ"}
        </button>
      </div>
      <pre
        dir="ltr"
        className="p-4 text-xs text-emerald-300 font-mono overflow-x-auto text-start leading-relaxed whitespace-pre"
      >
        {code}
      </pre>
    </div>
  );
}
