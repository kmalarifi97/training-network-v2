"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ==================================================================
   MOCK DATA — no API calls. Everything below is what the judges see.
   ================================================================== */

/* --- GPUs owned by OTHER users, available to rent ----------------- */

interface OwnerGpu {
  id: string;
  owner_username: string;
  owner_city: string;
  gpu_model: string;
  gpu_memory_gb: number;
  gpu_count: number;
  status: "online" | "offline";
  last_seen_label: string;
}

const RENTABLE_GPUS: OwnerGpu[] = [
  {
    id: "rent-1",
    owner_username: "@ahmad.ml",
    owner_city: "الرياض",
    gpu_model: "NVIDIA RTX 4080",
    gpu_memory_gb: 16,
    gpu_count: 1,
    status: "online",
    last_seen_label: "قبل 4 ثوانٍ",
  },
  {
    id: "rent-2",
    owner_username: "@sara.mlops",
    owner_city: "جدة",
    gpu_model: "NVIDIA RTX 3090",
    gpu_memory_gb: 24,
    gpu_count: 1,
    status: "online",
    last_seen_label: "قبل 9 ثوانٍ",
  },
  {
    id: "rent-3",
    owner_username: "@abdullah.dev",
    owner_city: "الدمام",
    gpu_model: "NVIDIA A4000",
    gpu_memory_gb: 16,
    gpu_count: 2,
    status: "online",
    last_seen_label: "قبل 11 ثانية",
  },
  {
    id: "rent-4",
    owner_username: "@norah_ai",
    owner_city: "الرياض",
    gpu_model: "NVIDIA RTX 4090",
    gpu_memory_gb: 24,
    gpu_count: 1,
    status: "online",
    last_seen_label: "قبل 3 ثوانٍ",
  },
  {
    id: "rent-5",
    owner_username: "@omar.kaust",
    owner_city: "ثول",
    gpu_model: "NVIDIA A100",
    gpu_memory_gb: 40,
    gpu_count: 1,
    status: "offline",
    last_seen_label: "قبل 8 دقائق",
  },
];

/* --- MY GPUs (ones I host on the network) ------------------------- */

interface MyGpu {
  id: string;
  friendly_name: string;
  hint: string;
  gpu_model: string;
  gpu_memory_gb: number;
  status: "online" | "offline";
  last_seen_label: string;
  total_hours_rented: number;
}

const MY_GPUS: MyGpu[] = [
  {
    id: "me-1",
    friendly_name: "لابتوبي",
    hint: "MacBook Pro — الذي أحمله معي",
    gpu_model: "NVIDIA RTX 3060 Laptop",
    gpu_memory_gb: 6,
    status: "online",
    last_seen_label: "قبل 12 ثانية",
    total_hours_rented: 3,
  },
  {
    id: "me-2",
    friendly_name: "حاسوب المنزل",
    hint: "تجميعة شخصية في غرفة المكتب",
    gpu_model: "NVIDIA RTX 4070",
    gpu_memory_gb: 12,
    status: "online",
    last_seen_label: "قبل 3 ثوانٍ",
    total_hours_rented: 12,
  },
];

const DEFAULT_IMAGE = "kmalarifi/llm-finetune:v1";
const DEFAULT_REPO = "https://github.com/kmalarifi/finetune-demo";

const CURRENT_USER = "kmalarifi@gmail.com";
const CURRENT_HANDLE = "@kmalarifi";

/* Timed phases drive the scripted progress bar on the running screen. */
interface ProgressPhase {
  at: number;
  pct: number;
  label: string;
}

const PHASES: ProgressPhase[] = [
  { at: 0, pct: 2, label: "جاري إعداد المهمة..." },
  { at: 1, pct: 8, label: "تعيين المهمة إلى الـ GPU المختار" },
  { at: 2, pct: 18, label: "جاري سحب صورة Docker (3.8 جيجابايت)..." },
  { at: 5, pct: 36, label: "جاري سحب صورة Docker (3.8 جيجابايت)..." },
  { at: 7, pct: 46, label: "صورة Docker جاهزة" },
  { at: 8, pct: 52, label: "تشغيل الحاوية مع دعم الـ GPU (--gpus all)" },
  { at: 9, pct: 58, label: "استنساخ مستودع GitHub وقراءة بيانات التدريب" },
  { at: 11, pct: 66, label: "تحميل نموذج TinyLlama إلى ذاكرة الـ GPU..." },
  { at: 13, pct: 72, label: "بدأ التدريب — الحقبة 1 من 3" },
  { at: 16, pct: 82, label: "التدريب مستمر — الحقبة 2 من 3 (الخسارة ↘ 1.24)" },
  { at: 19, pct: 92, label: "التدريب مستمر — الحقبة 3 من 3 (الخسارة ↘ 0.62)" },
  { at: 21, pct: 98, label: "جاري حفظ محوّل LoRA..." },
  { at: 22, pct: 100, label: "اكتملت المهمة بنجاح ✓" },
];

interface MockLog {
  stream: "system" | "stdout" | "stderr";
  content: string;
  at: number;
}

const MOCK_LOGS: MockLog[] = [
  { stream: "system", content: "▸ تم استلام المهمة (id: a3f2c1e4...)", at: 0 },
  { stream: "system", content: "▸ تم تعيين المهمة إلى: ahmad.ml (RTX 4080)", at: 1 },
  { stream: "system", content: "▸ جاري سحب kmalarifi/llm-finetune:v1", at: 2 },
  { stream: "system", content: "Pulling from kmalarifi/llm-finetune", at: 3 },
  { stream: "system", content: "58ab47faa891: Already exists", at: 3 },
  { stream: "system", content: "a55e85e18c83: Downloading  123.4MB / 3.8GB", at: 4 },
  { stream: "system", content: "a55e85e18c83: Downloading  1.12GB / 3.8GB", at: 5 },
  { stream: "system", content: "a55e85e18c83: Downloading  2.41GB / 3.8GB", at: 6 },
  { stream: "system", content: "a55e85e18c83: Pull complete", at: 7 },
  { stream: "system", content: "▸ الصورة جاهزة (3.8 جيجابايت)", at: 7 },
  { stream: "system", content: "▸ تشغيل الحاوية مع --gpus all", at: 8 },
  { stream: "stdout", content: "Cloning into 'repo'...", at: 9 },
  { stream: "stdout", content: "Loading dataset from data/train.csv...", at: 10 },
  { stream: "stdout", content: "Loaded 10 training examples", at: 10 },
  { stream: "stdout", content: "Loading base model TinyLlama/TinyLlama-1.1B-Chat-v1.0...", at: 11 },
  { stream: "stdout", content: "Loaded in 8.2s", at: 13 },
  { stream: "stdout", content: "trainable params: 1,703,936 | all params: 1,101,582,336 | trainable%: 0.15", at: 13 },
  { stream: "stdout", content: "Starting fine-tuning for 3 epochs...", at: 13 },
  { stream: "stdout", content: "{'loss': 2.4531, 'step': 1}", at: 14 },
  { stream: "stdout", content: "{'loss': 2.1240, 'step': 2}", at: 15 },
  { stream: "stdout", content: "{'loss': 1.8834, 'step': 3}", at: 15 },
  { stream: "stdout", content: "{'loss': 1.5721, 'step': 5}", at: 16 },
  { stream: "stdout", content: "{'loss': 1.2410, 'step': 10}", at: 17 },
  { stream: "stdout", content: "{'loss': 0.9823, 'step': 15}", at: 18 },
  { stream: "stdout", content: "{'loss': 0.7212, 'step': 20}", at: 19 },
  { stream: "stdout", content: "{'loss': 0.6234, 'step': 25}", at: 20 },
  { stream: "stdout", content: "{'loss': 0.5812, 'step': 30}", at: 21 },
  { stream: "stdout", content: "Fine-tuning complete.", at: 21 },
  { stream: "stdout", content: "Saved LoRA adapter to ./output", at: 22 },
  { stream: "stdout", content: "DONE.", at: 22 },
  { stream: "system", content: "▸ خرجت الحاوية (رمز 0)", at: 22 },
  { stream: "system", content: "▸ اكتمل التدريب — تم استخدام 22 ثانية على GPU", at: 22 },
];

/* ==================================================================
   State machine + helpers
   ================================================================== */

type Phase =
  | "login"
  | "rent_browse"
  | "rent_submit"
  | "rent_running"
  | "rent_done"
  | "my_gpus"
  | "add_gpu_form"
  | "add_gpu_success";

/* Which sidebar section each phase belongs to. */
function sidebarSection(p: Phase): "rent" | "host" | null {
  if (p === "login") return null;
  if (p.startsWith("rent_")) return "rent";
  return "host";
}

function streamColor(s: MockLog["stream"]): string {
  if (s === "stdout") return "text-zinc-100";
  if (s === "stderr") return "text-amber-300";
  return "text-sky-400";
}

function currentPhase(elapsed: number): ProgressPhase {
  let cur = PHASES[0];
  for (const p of PHASES) if (elapsed >= p.at) cur = p;
  return cur;
}

function translateStatus(s: string): string {
  if (s === "online") return "متصل";
  if (s === "offline") return "غير متصل";
  if (s === "draining") return "قيد الإفراغ";
  return s;
}

/* ==================================================================
   Root
   ================================================================== */

export default function Home() {
  const [phase, setPhase] = useState<Phase>("login");
  const [user, setUser] = useState<string | null>(null);
  const [selectedRentable, setSelectedRentable] = useState<OwnerGpu | null>(null);
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [jobId] = useState(() => "a3f2c1e4b8d9");
  const [newGpuName, setNewGpuName] = useState("");

  const logout = useCallback(() => {
    setUser(null);
    setSelectedRentable(null);
    setPhase("login");
  }, []);

  return (
    <div className="min-h-screen bg-[#050507] text-zinc-100">
      <BackgroundGrain />
      <Header phase={phase} user={user} onLogout={logout} />

      {phase === "login" ? (
        <main className="relative mx-auto max-w-6xl px-6 py-10">
          <LoginView
            onSuccess={(email) => {
              setUser(email);
              setPhase("rent_browse");
            }}
          />
        </main>
      ) : (
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
                onStart={() => setPhase("rent_running")}
              />
            )}
            {phase === "rent_running" && selectedRentable && (
              <RunningView
                gpu={selectedRentable}
                image={image}
                jobId={jobId}
                onComplete={() => setPhase("rent_done")}
                onCancel={() => setPhase("rent_browse")}
              />
            )}
            {phase === "rent_done" && selectedRentable && (
              <DoneView
                gpu={selectedRentable}
                image={image}
                jobId={jobId}
                onAgain={() => setPhase("rent_submit")}
                onHome={() => {
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
                onSubmit={() => setPhase("add_gpu_success")}
              />
            )}
            {phase === "add_gpu_success" && (
              <AddGpuSuccessView
                name={newGpuName || "جهازي الجديد"}
                onDone={() => setPhase("my_gpus")}
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
  user: string | null;
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
              <div className="text-xs text-zinc-300">{CURRENT_HANDLE}</div>
              <div className="text-[10px] text-zinc-600">{user}</div>
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

function LoginView({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState("kmalarifi@gmail.com");
  const [password, setPassword] = useState("••••••••");
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => onSuccess(email || CURRENT_USER), 400);
  }

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
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">تسجيل الدخول</h2>
        <p className="text-xs text-zinc-500 mb-6">
          استخدم حسابك للوصول إلى أجهزتك ولبدء استئجار GPU من الشبكة.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              dir="ltr"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors text-start"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
              كلمة المرور
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "جاري الدخول..." : "دخول →"}
          </button>
        </form>
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

function RentBrowseView({ onPick }: { onPick: (g: OwnerGpu) => void }) {
  const onlineCount = RENTABLE_GPUS.filter((g) => g.status === "online").length;
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
          <span className="text-emerald-400 font-semibold">{onlineCount}</span> من{" "}
          {RENTABLE_GPUS.length} متصل الآن
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RENTABLE_GPUS.map((g) => (
          <RentableCard key={g.id} gpu={g} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function RentableCard({
  gpu,
  onPick,
}: {
  gpu: OwnerGpu;
  onPick: (g: OwnerGpu) => void;
}) {
  const available = gpu.status === "online";
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
              {gpu.owner_username.slice(1, 3).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div
                className="font-bold text-zinc-100 text-sm truncate"
                dir="ltr"
              >
                {gpu.owner_username}
              </div>
            </div>
          </div>
          <div className="text-xs text-zinc-500">{gpu.owner_city}</div>
        </div>
        <StatusPill status={gpu.status} />
      </div>

      <div className="space-y-2 text-sm border-t border-zinc-800 pt-4">
        <Row label="كرت الشاشة" value={gpu.gpu_model} mono />
        <Row label="ذاكرة الـ GPU" value={`${gpu.gpu_memory_gb} جيجابايت`} />
        <Row label="عدد وحدات الـ GPU" value={`${gpu.gpu_count}`} />
        <Row label="آخر نبضة" value={gpu.last_seen_label} muted />
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
  gpu: OwnerGpu;
  image: string;
  setImage: (v: string) => void;
  repo: string;
  setRepo: (v: string) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const [epochs, setEpochs] = useState(3);
  const [minutes, setMinutes] = useState(10);

  const cmdPreview = useMemo(
    () =>
      `bash -c "git clone --depth 1 ${repo} repo && cd repo && python3 train.py --epochs ${epochs}"`,
    [repo, epochs],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onStart();
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
            <span dir="ltr">{gpu.owner_username}</span>
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

        <button
          type="submit"
          className="w-full rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 px-4 py-3.5 text-sm font-semibold text-white transition-all shadow-lg shadow-emerald-500/20"
        >
          🚀 ابدأ التنفيذ على GPU الخاص بـ {gpu.owner_username}
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
  gpu: OwnerGpu;
  image: string;
  jobId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const stdoutRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startRef.current = Date.now();
    const t = setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000;
      setElapsed(s);
      if (s >= 22.5) {
        clearInterval(t);
        setTimeout(onComplete, 900);
      }
    }, 100);
    return () => clearInterval(t);
  }, [onComplete]);

  const phase = currentPhase(elapsed);
  const pct = Math.min(100, Math.round(phase.pct));
  const visible = MOCK_LOGS.filter((l) => l.at <= elapsed);
  const stdoutLogs = visible.filter((l) => l.stream !== "system");
  const systemLogs = visible.filter((l) => l.stream === "system");

  useEffect(() => {
    if (stdoutRef.current) stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
    if (systemRef.current) systemRef.current.scrollTop = systemRef.current.scrollHeight;
  }, [visible.length]);

  const latestLoss = useMemo(() => {
    for (let i = stdoutLogs.length - 1; i >= 0; i--) {
      const m = stdoutLogs[i].content.match(/'loss':\s*([\d.]+)/);
      if (m) return m[1];
    }
    return "—";
  }, [stdoutLogs]);

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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
              قيد التنفيذ
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-400 flex-wrap">
            <span>على GPU:</span>
            <span className="text-emerald-400 font-medium" dir="ltr">
              {gpu.owner_username}
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
          onClick={onCancel}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20 transition-colors"
        >
          إلغاء المهمة
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm text-zinc-300 font-medium">{phase.label}</div>
          <div className="text-3xl font-bold tabular-nums text-emerald-400" dir="ltr">
            {pct}%
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-l from-emerald-400 via-emerald-500 to-cyan-500 transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] text-zinc-500">
          <PhaseMilestone label="سحب الصورة" done={pct >= 46} active={pct < 46} />
          <PhaseMilestone label="بدء الحاوية" done={pct >= 58} active={pct >= 46 && pct < 58} />
          <PhaseMilestone label="تحميل النموذج" done={pct >= 72} active={pct >= 58 && pct < 72} />
          <PhaseMilestone label="التدريب" done={pct >= 98} active={pct >= 72 && pct < 98} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <HighlightCard label="الوقت المنقضي" value={`${elapsed.toFixed(1)} ث`} tone="info" />
        <HighlightCard label="آخر قيمة خسارة" value={latestLoss} tone="info" />
        <HighlightCard
          label="استخدام الـ GPU"
          value={elapsed > 12 ? "92٪" : elapsed > 8 ? "14٪" : "0٪"}
          tone="ok"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4 h-[420px]">
        <LogPanel
          title="مخرجات الحاوية"
          subtitle="stdout و stderr من سكربت التدريب"
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

function PhaseMilestone({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  const color = done ? "text-emerald-400" : active ? "text-sky-400" : "text-zinc-600";
  const dot = done ? "bg-emerald-400" : active ? "bg-sky-400 animate-pulse" : "bg-zinc-700";
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className={color}>{label}</span>
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
  logs: MockLog[];
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
  gpu: OwnerGpu;
  image: string;
  jobId: string;
  onAgain: () => void;
  onHome: () => void;
}) {
  return (
    <div>
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 mb-5">
          <svg
            className="h-10 w-10 text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">اكتملت المهمة بنجاح</h1>
        <p className="text-sm text-zinc-400">
          تم تدريب النموذج على GPU التابع لـ{" "}
          <span className="text-emerald-400 font-mono" dir="ltr">
            {gpu.owner_username}
          </span>{" "}
          وحفظ محوّل LoRA بنجاح.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 mb-5">
        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-4">
          ملخّص المهمة
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <SummaryRow label="رقم المهمة" value={`#${jobId.slice(0, 8)}`} mono />
          <SummaryRow label="الحالة" value="اكتملت" tone="ok" />
          <SummaryRow label="مالك الـ GPU" value={gpu.owner_username} mono />
          <SummaryRow label="كرت الشاشة" value={gpu.gpu_model} mono />
          <SummaryRow label="المدة الفعلية" value="22.4 ثانية" mono />
          <SummaryRow label="استهلاك الذاكرة" value={`4.2 / ${gpu.gpu_memory_gb} جيجا`} mono />
          <SummaryRow label="الخسارة الأولى" value="2.4531" mono />
          <SummaryRow label="الخسارة النهائية" value="0.5812" tone="ok" mono />
          <SummaryRow label="عدد الخطوات" value="30 (3 حقبات)" />
          <SummaryRow label="الحاوية" value={image} mono />
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 mb-8">
        <div className="flex items-start gap-3">
          <div className="h-6 w-6 rounded bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-xs flex-shrink-0">
            ✓
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-emerald-200">تم حفظ النموذج داخل الحاوية</div>
            <div className="text-xs text-emerald-400/80 mt-1.5 leading-relaxed">
              محوّل LoRA محفوظ في <span className="font-mono" dir="ltr">./output</span>. هذا ملف
              صغير (~2 ميجا) يحتوي على التعديلات التي تعلّمها النموذج من بيانات التدريب.
            </div>
          </div>
        </div>
      </div>

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
  const onlineCount = MY_GPUS.filter((g) => g.status === "online").length;
  const totalHours = MY_GPUS.reduce((s, g) => s + g.total_hours_rented, 0);
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

      {/* Small stats header */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <HighlightCard label="عدد أجهزتي" value={String(MY_GPUS.length)} tone="info" />
        <HighlightCard
          label="المتصلة الآن"
          value={`${onlineCount} / ${MY_GPUS.length}`}
          tone="ok"
        />
        <HighlightCard
          label="ساعات GPU مُجمَّعة"
          value={`${totalHours} ساعة`}
          tone="info"
        />
      </div>

      <div className="space-y-3">
        {MY_GPUS.map((g) => (
          <MyGpuRow key={g.id} gpu={g} />
        ))}
      </div>

      {/* Hint panel */}
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

function MyGpuRow({ gpu }: { gpu: MyGpu }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex items-center gap-5">
      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center text-xl flex-shrink-0">
        🖥️
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1">
          <h3 className="font-bold text-zinc-100 text-base">{gpu.friendly_name}</h3>
          <StatusPill status={gpu.status} />
        </div>
        <div className="text-xs text-zinc-500 mb-2">{gpu.hint}</div>
        <div className="flex gap-5 text-xs text-zinc-400 flex-wrap">
          <span>
            <span className="text-zinc-600">كرت: </span>
            <span className="font-mono text-zinc-300" dir="ltr">
              {gpu.gpu_model}
            </span>
          </span>
          <span>
            <span className="text-zinc-600">ذاكرة: </span>
            <span className="text-zinc-300">{gpu.gpu_memory_gb} جيجا</span>
          </span>
          <span>
            <span className="text-zinc-600">ساعات تم تأجيرها: </span>
            <span className="text-emerald-400 font-semibold tabular-nums">
              {gpu.total_hours_rented}
            </span>
          </span>
          <span>
            <span className="text-zinc-600">آخر نبضة: </span>
            <span className="text-zinc-400">{gpu.last_seen_label}</span>
          </span>
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors">
          تفاصيل
        </button>
        <button className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-colors">
          إزالة
        </button>
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
  onSubmit,
}: {
  name: string;
  setName: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTimeout(onSubmit, 500);
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

function AddGpuSuccessView({
  name,
  onDone,
}: {
  name: string;
  onDone: () => void;
}) {
  const claimToken = "gpuclaim_Vq3k7pNxR8mLwF2aZbY9sTcH4gJ6dEuK";
  const installCmd = `gpu-agent init \\
  --control-plane=http://34.18.164.66:8000 \\
  --claim-token=${claimToken} \\
  --name="${name}"`;
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-7">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          تم إنشاء رمز التسجيل
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          خطوة واحدة أخيرة: شغّل الأمر على «{name}»
        </h1>
        <p className="text-sm text-zinc-400 max-w-xl leading-relaxed">
          انسخ الأمر أدناه وشغّله في terminal الجهاز الذي تريد إضافته. فور انتهاء التسجيل،
          سيظهر الجهاز في قائمتك وسيكون متاحاً للاستئجار.
        </p>
      </div>

      {/* The install command — the money shot for this screen */}
      <div className="rounded-xl border border-zinc-800 bg-black/50 overflow-hidden mb-5">
        <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <div className="text-xs text-zinc-400 font-medium">أمر التسجيل</div>
          <button
            onClick={copy}
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
          className="p-4 text-xs text-emerald-300 font-mono overflow-x-auto text-start leading-relaxed"
        >
          {installCmd}
        </pre>
      </div>

      {/* Token separately, with a warning */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 mb-5">
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
              {claimToken}
            </code>
          </div>
        </div>
      </div>

      {/* Requirements */}
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
            <span>نظام Linux أو macOS (Windows عبر WSL2).</span>
          </li>
        </ul>
      </div>

      <button
        onClick={onDone}
        className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
      >
        حسناً، سيظهر «{name}» في قائمتي بعد التشغيل
      </button>
    </div>
  );
}
