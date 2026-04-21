"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  apiFetch,
  clearToken,
  getEmail,
  getToken,
  setEmail as persistEmail,
  setToken,
  type ApiError,
  type TokenResponse,
  type UserResponse,
} from "@/lib/api";

/* ==================================================================
   /activate — browser side of the device-code onboarding flow.

   The agent on a host PC prints:
     "Visit https://<ui>/activate and enter code ABCD-EFGH"
   and polls the control plane. The user lands here, signs in if
   needed, types the code, confirms — and the agent picks up an
   agent_token on its next poll.
   ================================================================== */

interface ActivateResponse {
  status: "approved";
  gpu_model: string;
  gpu_memory_gb: number;
  gpu_count: number;
}

type Phase =
  | "loading"
  | "login"
  | "not_host"
  | "pending_approval"
  | "entry"
  | "success";

function normalizeCode(raw: string): string {
  // Strip whitespace, uppercase, squash dashes to a single canonical XXXX-XXXX.
  const stripped = raw.replace(/[\s-]/g, "").toUpperCase();
  if (stripped.length <= 4) return stripped;
  return `${stripped.slice(0, 4)}-${stripped.slice(4, 8)}`;
}

function reasonToArabic(reason: string | undefined, fallback: string): string {
  switch (reason) {
    case "unknown code":
    case "unknown token":
      return "الرمز غير صحيح — تأكد من كتابة ما يظهر على جهازك.";
    case "expired":
      return "انتهت صلاحية الرمز. اطلب رمزا جديدا على جهازك.";
    case "already used":
    case "already consumed":
      return "تم استخدام هذا الرمز مسبقا. اطلب رمزا جديدا على جهازك.";
    case "approved by a different user":
      return "تمت الموافقة على هذا الرمز من حساب آخر.";
    default:
      return fallback;
  }
}

export default function ActivatePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<UserResponse | null>(null);
  const [prefillCode, setPrefillCode] = useState("");
  const [approvedSpec, setApprovedSpec] = useState<ActivateResponse | null>(null);

  // Read ?code=XXXX-XXXX once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("code");
    if (raw) setPrefillCode(normalizeCode(raw));
  }, []);

  const routeForUser = useCallback((me: UserResponse) => {
    setUser(me);
    if (me.status !== "active") {
      setPhase("pending_approval");
      return;
    }
    if (!me.can_host) {
      setPhase("not_host");
      return;
    }
    setPhase("entry");
  }, []);

  // Boot: if we have a JWT, validate it; otherwise show login.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!getToken()) {
        setPhase("login");
        return;
      }
      try {
        const me = await apiFetch<UserResponse>("/api/me");
        if (!cancelled) routeForUser(me);
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
  }, [routeForUser]);

  function logout() {
    clearToken();
    setUser(null);
    setPhase("login");
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <ActivateHeader user={user} onLogout={logout} />

      <main className="relative flex-1 mx-auto w-full max-w-xl px-6 py-12">
        {phase === "loading" && <LoadingCard />}
        {phase === "login" && (
          <InlineLoginView onSuccess={routeForUser} prefillCode={prefillCode} />
        )}
        {phase === "pending_approval" && user && <PendingApprovalCard user={user} />}
        {phase === "not_host" && user && <NotAHostCard user={user} />}
        {phase === "entry" && (
          <CodeEntryView
            initialCode={prefillCode}
            onApproved={(spec) => {
              setApprovedSpec(spec);
              setPhase("success");
            }}
          />
        )}
        {phase === "success" && approvedSpec && <SuccessCard spec={approvedSpec} />}
      </main>

      <ActivateFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chrome                                                             */
/* ------------------------------------------------------------------ */

function ActivateHeader({
  user,
  onLogout,
}: {
  user: UserResponse | null;
  onLogout: () => void;
}) {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Logo />
          <span className="font-semibold text-[0.95rem] tracking-tight">
            شبكة <span className="mono">GPU</span>
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted hidden sm:inline" dir="ltr">
              {user.email}
            </span>
            <button
              onClick={onLogout}
              className="text-muted hover:text-foreground transition-colors"
            >
              تسجيل الخروج
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect
        x="2"
        y="2"
        width="24"
        height="24"
        rx="7"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <circle cx="9" cy="9" r="1.75" fill="var(--accent)" />
      <circle cx="19" cy="9" r="1.75" fill="var(--accent)" />
      <circle cx="9" cy="19" r="1.75" fill="var(--accent)" />
      <circle cx="19" cy="19" r="1.75" fill="var(--accent)" />
      <path
        d="M9 9L19 19M19 9L9 19"
        stroke="var(--accent)"
        strokeWidth="1.1"
        opacity="0.55"
      />
    </svg>
  );
}

function ActivateFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between text-xs text-muted">
        <span>© 2026 شبكة GPU</span>
        <Link href="/app" className="hover:text-foreground transition-colors">
          لوحة التحكم ←
        </Link>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                            */
/* ------------------------------------------------------------------ */

function LoadingCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <div className="inline-block h-6 w-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin mb-4" />
      <p className="text-sm text-muted">جاري التحقق من الجلسة...</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pending-approval + not-host branches                               */
/* ------------------------------------------------------------------ */

function PendingApprovalCard({ user }: { user: UserResponse }) {
  return (
    <div className="text-center">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-8">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-amber-500/15 border-2 border-amber-500/30 mb-5 text-3xl">
          ⏳
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">حسابك قيد المراجعة</h1>
        <p className="text-sm text-muted-hi leading-relaxed mb-5">
          لا يمكنك تفعيل جهاز جديد قبل أن يوافق المشرف على حسابك. بعد التفعيل،
          أعد تحميل هذه الصفحة وستتمكن من إدخال الرمز.
        </p>
        <div className="rounded-md bg-surface-hi/40 border border-border p-3 text-xs text-muted space-y-1 max-w-xs mx-auto">
          <div className="flex justify-between gap-3">
            <span>البريد:</span>
            <span className="text-muted-hi font-mono truncate" dir="ltr">
              {user.email}
            </span>
          </div>
          <div className="flex justify-between">
            <span>الحالة:</span>
            <span className="text-amber-800">
              {user.status === "suspended" ? "موقوف" : "بانتظار الموافقة"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotAHostCard({ user }: { user: UserResponse }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-surface-hi border border-border mb-5 text-3xl">
        🔒
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">
        حسابك غير مفعل لاستضافة GPU
      </h1>
      <p className="text-sm text-muted-hi leading-relaxed mb-5 max-w-md mx-auto">
        تفعيل جهاز جديد يتطلب صلاحية الاستضافة. تواصل مع مشرف الشبكة ليفعل
        حسابك كمستضيف، ثم أعد تحميل هذه الصفحة.
      </p>
      <div className="rounded-md bg-surface-hi/40 border border-border p-3 text-xs text-muted max-w-xs mx-auto">
        <div className="flex justify-between gap-3">
          <span>البريد:</span>
          <span className="text-muted-hi font-mono truncate" dir="ltr">
            {user.email}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline login (subset of the /app LoginView — stays on /activate)   */
/* ------------------------------------------------------------------ */

function InlineLoginView({
  onSuccess,
  prefillCode,
}: {
  onSuccess: (user: UserResponse) => void;
  prefillCode: string;
}) {
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

  return (
    <div>
      <div className="text-center mb-7">
        <div className="pill w-fit mx-auto mb-4">
          <span className="pulse-dot" />
          تفعيل جهاز جديد
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          سجل الدخول لإكمال التفعيل
        </h1>
        <p className="text-sm text-muted-hi leading-relaxed max-w-sm mx-auto">
          الرمز الذي يظهر على جهازك ينتظر الموافقة من حسابك. سجل دخولك لمرة
          واحدة لربط الجهاز بك.
        </p>
        {prefillCode && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent-dim px-3 py-1.5 text-[12px] text-accent">
            <span>الرمز جاهز:</span>
            <code className="mono font-semibold" dir="ltr">
              {prefillCode}
            </code>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {mode === "signup" ? "إنشاء حساب جديد" : "تسجيل الدخول"}
        </h2>
        <p className="text-xs text-muted mb-5">
          {mode === "signup"
            ? "سجل ليصبح بإمكانك استضافة أجهزة GPU."
            : "استخدم حسابك لربط هذا الجهاز بك."}
        </p>
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
              className="w-full rounded-lg border border-border-hi bg-surface-hi/60 px-4 py-2.5 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 text-start"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-hi mb-1.5 uppercase tracking-wide">
              كلمة المرور
              {mode === "signup" && (
                <span className="text-muted normal-case">
                  {" "}
                  (8 أحرف أو أكثر)
                </span>
              )}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : 1}
              className="w-full rounded-lg border border-border-hi bg-surface-hi/60 px-4 py-2.5 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
          {error && (
            <div
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700"
              dir="ltr"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hi disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy
              ? mode === "signup"
                ? "جاري الإنشاء..."
                : "جاري الدخول..."
              : mode === "signup"
                ? "إنشاء الحساب ←"
                : "دخول ←"}
          </button>
        </form>

        <div className="mt-5 pt-5 border-t border-border text-center text-xs text-muted">
          {mode === "login" ? (
            <>
              ليس لديك حساب؟{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="text-accent font-medium"
              >
                إنشاء حساب جديد
              </button>
            </>
          ) : (
            <>
              لديك حساب بالفعل؟{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="text-accent font-medium"
              >
                تسجيل الدخول
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code entry                                                         */
/* ------------------------------------------------------------------ */

function CodeEntryView({
  initialCode,
  onApproved,
}: {
  initialCode: string;
  onApproved: (spec: ActivateResponse) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input after mount so the user can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
    if (initialCode) inputRef.current?.select();
  }, [initialCode]);

  const canSubmit = useMemo(
    () => code.replace(/-/g, "").length === 8 && !busy,
    [code, busy],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const spec = await apiFetch<ActivateResponse>("/api/devices/activate", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      onApproved(spec);
    } catch (err) {
      const e = err as ApiError;
      const reason = (e?.payload as { reason?: string } | undefined)?.reason;
      if (e?.status === 403) {
        setError(
          "حسابك غير مفعل لاستضافة GPU. تواصل مع المشرف لتفعيل صلاحية الاستضافة.",
        );
      } else {
        setError(reasonToArabic(reason, e?.detail || "تعذر تفعيل الرمز"));
      }
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="text-center mb-8">
        <div className="pill w-fit mx-auto mb-4">
          <span className="pulse-dot" />
          تفعيل جهاز جديد
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          أدخل الرمز الذي يظهر على جهازك
        </h1>
        <p className="text-sm text-muted-hi leading-relaxed max-w-md mx-auto">
          هذا الرمز يتكون من ثمانية أحرف (XXXX-XXXX) ويظهر في الترمنال بعد
          تشغيل أمر التثبيت.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-border bg-surface p-7 shadow-sm"
      >
        <label
          htmlFor="device-code"
          className="block text-xs font-medium text-muted-hi mb-2 uppercase tracking-wider"
        >
          رمز الجهاز
        </label>
        <input
          id="device-code"
          ref={inputRef}
          type="text"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          placeholder="XXXX-XXXX"
          dir="ltr"
          className="w-full rounded-xl border border-border-hi bg-surface-hi/60 px-5 py-4 text-center text-3xl sm:text-4xl font-mono font-semibold tracking-[0.25em] text-foreground placeholder-muted/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
        />

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 leading-relaxed">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-5 w-full rounded-lg bg-accent hover:bg-accent-hi px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "جاري التفعيل..." : "تفعيل الرمز ←"}
        </button>
      </form>

      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface/50 p-4 text-xs text-muted-hi leading-relaxed">
        <div className="font-semibold text-foreground mb-1.5">ماذا يحدث بعد ذلك؟</div>
        بعد موافقتك، يلتقط الوكيل الموجود على جهازك هذا الإذن تلقائيا خلال
        ثوان. سيظهر الجهاز في{" "}
        <Link href="/app" className="text-accent">
          «أجهزة GPU الخاصة بي»
        </Link>{" "}
        عند اتصاله لأول مرة.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Success                                                            */
/* ------------------------------------------------------------------ */

function SuccessCard({ spec }: { spec: ActivateResponse }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-accent-dim border-2 border-accent/30 mb-5 text-3xl text-accent">
        ✓
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">تمت الموافقة</h1>
      <p className="text-sm text-muted-hi leading-relaxed mb-6 max-w-md mx-auto">
        الوكيل على جهازك سيلتقط الموافقة تلقائيا خلال لحظات ويكمل التسجيل. لا
        حاجة لفعل أي شيء هنا.
      </p>

      <div className="rounded-xl border border-border bg-surface p-5 text-start max-w-sm mx-auto mb-6">
        <div className="text-xs text-muted-hi font-medium mb-3 uppercase tracking-wider">
          مواصفات الجهاز
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted">الكرت:</span>
            <span className="font-mono text-muted-hi" dir="ltr">
              {spec.gpu_model}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">الذاكرة:</span>
            <span className="text-muted-hi">{spec.gpu_memory_gb} جيجا</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">عدد GPUs:</span>
            <span className="text-muted-hi">{spec.gpu_count}</span>
          </div>
        </div>
      </div>

      <Link
        href="/app"
        className="inline-block rounded-lg bg-accent hover:bg-accent-hi px-5 py-2.5 text-sm font-semibold text-white transition-colors"
      >
        الذهاب إلى أجهزتي ←
      </Link>
    </div>
  );
}
