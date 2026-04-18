"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ==================================================================
   MOCK DATA — no API calls. Everything below is what the judges see.
   ================================================================== */

interface NodeRow {
  id: string;
  name: string;
  owner: string;
  location: string;
  machine: string;
  gpu_model: string;
  gpu_memory_gb: number;
  gpu_count: number;
  status: "online" | "offline" | "draining";
  last_seen_label: string;
}

const MOCK_NODES: NodeRow[] = [
  {
    id: "laptop-khalid",
    name: "لابتوب خالد",
    owner: "khalid@شبكة",
    location: "الرياض، السعودية",
    machine: "MacBook Pro · خالد",
    gpu_model: "NVIDIA RTX 3060 Laptop",
    gpu_memory_gb: 6,
    gpu_count: 1,
    status: "online",
    last_seen_label: "قبل 12 ثانية",
  },
  {
    id: "home-pc",
    name: "حاسوب المنزل",
    owner: "khalid@شبكة",
    location: "الرياض، السعودية",
    machine: "تجميعة شخصية · غرفة المكتب",
    gpu_model: "NVIDIA RTX 4070",
    gpu_memory_gb: 12,
    gpu_count: 1,
    status: "online",
    last_seen_label: "قبل 3 ثوانٍ",
  },
];

const DEFAULT_IMAGE = "kmalarifi/llm-finetune:v1";
const DEFAULT_REPO = "https://github.com/kmalarifi/finetune-demo";

/* Timed phases that advance the fake progress bar. Each entry says
   "at this second mark, the progress reaches pct and the phase label
   becomes …". Used both for the bar % and the current-phase label. */
interface Phase {
  at: number;
  pct: number;
  label: string;
}

const PHASES: Phase[] = [
  { at: 0, pct: 2, label: "جاري إعداد المهمة..." },
  { at: 1, pct: 8, label: "تعيين المهمة إلى الجهاز المختار" },
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

/* Scripted log lines that appear as the progress advances. Each line's
   "at" is roughly the second it first appears. Screenshot-friendly:
   Arabic system events + English ML output, as it would look live. */
interface MockLog {
  stream: "system" | "stdout" | "stderr";
  content: string;
  at: number;
}

const MOCK_LOGS: MockLog[] = [
  { stream: "system", content: "▸ تم استلام المهمة (id: a3f2c1e4...)", at: 0 },
  { stream: "system", content: "▸ تم تعيينها إلى: حاسوب المنزل (NVIDIA RTX 4070)", at: 1 },
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
   Small helpers
   ================================================================== */

type Phase5 = "login" | "gpus" | "submit" | "running" | "done";

function streamColor(s: MockLog["stream"]): string {
  if (s === "stdout") return "text-zinc-100";
  if (s === "stderr") return "text-amber-300";
  return "text-sky-400";
}

function currentPhase(elapsed: number): Phase {
  let current = PHASES[0];
  for (const p of PHASES) {
    if (elapsed >= p.at) current = p;
  }
  return current;
}

/* ==================================================================
   Root
   ================================================================== */

export default function Home() {
  const [phase, setPhase] = useState<Phase5>("login");
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeRow | null>(null);
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [jobId] = useState(() => "a3f2c1e4b8d9");

  return (
    <div className="min-h-screen bg-[#050507] text-zinc-100">
      <BackgroundGrain />
      <Header
        phase={phase}
        selectedNode={selectedNode}
        user={currentUser}
        onLogout={() => {
          setCurrentUser(null);
          setSelectedNode(null);
          setPhase("login");
        }}
      />
      <main className="relative mx-auto max-w-6xl px-6 py-10">
        {phase === "login" && (
          <LoginView
            onSuccess={(email) => {
              setCurrentUser(email);
              setPhase("gpus");
            }}
          />
        )}
        {phase === "gpus" && (
          <BrowseView
            onPick={(n) => {
              setSelectedNode(n);
              setPhase("submit");
            }}
          />
        )}
        {phase === "submit" && selectedNode && (
          <SubmitView
            node={selectedNode}
            image={image}
            setImage={setImage}
            repo={repo}
            setRepo={setRepo}
            onBack={() => setPhase("gpus")}
            onStart={() => setPhase("running")}
          />
        )}
        {phase === "running" && selectedNode && (
          <RunningView
            node={selectedNode}
            image={image}
            jobId={jobId}
            onComplete={() => setPhase("done")}
            onCancel={() => setPhase("gpus")}
          />
        )}
        {phase === "done" && selectedNode && (
          <DoneView
            node={selectedNode}
            image={image}
            jobId={jobId}
            onAgain={() => {
              setPhase("submit");
            }}
            onHome={() => {
              setSelectedNode(null);
              setPhase("gpus");
            }}
          />
        )}
      </main>
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
   Header + Footer
   ================================================================== */

function Header({
  phase,
  selectedNode,
  user,
  onLogout,
}: {
  phase: Phase5;
  selectedNode: NodeRow | null;
  user: string | null;
  onLogout: () => void;
}) {
  const crumbs: string[] = ["الشبكة"];
  if (phase === "gpus" || phase === "submit" || phase === "running" || phase === "done")
    crumbs.push("الأجهزة");
  if ((phase === "submit" || phase === "running" || phase === "done") && selectedNode)
    crumbs.push(selectedNode.name);
  if (phase === "running") crumbs.push("قيد التنفيذ");
  if (phase === "done") crumbs.push("اكتملت");

  return (
    <header className="relative border-b border-zinc-900 bg-[#050507]/90 backdrop-blur-sm sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
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
          <span className="text-zinc-800">|</span>
          <nav className="text-sm text-zinc-400 flex items-center gap-1">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-700 px-1">›</span>}
                <span className={i === crumbs.length - 1 ? "text-zinc-200" : ""}>{c}</span>
              </span>
            ))}
          </nav>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">{user}</span>
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

function Footer() {
  return (
    <footer className="mt-16 border-t border-zinc-900 py-6">
      <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-[11px] text-zinc-600">
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
   Phase 1: Login
   ================================================================== */

function LoginView({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState("kmalarifi@gmail.com");
  const [password, setPassword] = useState("••••••••");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      onSuccess(email || "kmalarifi@gmail.com");
    }, 500);
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
          <span className="text-zinc-500">
            لا سحابة. لا وسطاء. فقط شبكتك.
          </span>
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-lg">
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">تسجيل الدخول</h2>
        <p className="text-xs text-zinc-500 mb-6">استخدم حسابك للوصول إلى أجهزتك المسجّلة.</p>
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
        بالدخول أنت توافق على أن مهامك ستُشغّل على أجهزة الشبكة المختارة.
      </p>
    </div>
  );
}

/* ==================================================================
   Phase 2: Browse GPUs
   ================================================================== */

function BrowseView({ onPick }: { onPick: (n: NodeRow) => void }) {
  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">اختر جهازاً لتشغيل مهمتك</h1>
          <p className="text-sm text-zinc-400 mt-1.5">
            أجهزتك المسجّلة في الشبكة — مُتاحة الآن. المهمة تُرسَل مباشرة إلى الجهاز الذي تختاره.
          </p>
        </div>
        <div className="text-xs text-zinc-500 tabular-nums">
          {MOCK_NODES.length} أجهزة متصلة
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {MOCK_NODES.map((n) => (
          <GpuCard key={n.id} node={n} onPick={onPick} />
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-5 flex items-start gap-4">
        <div className="h-8 w-8 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-sm flex-shrink-0">
          +
        </div>
        <div className="flex-1">
          <div className="text-sm text-zinc-300 font-medium">تريد إضافة جهاز جديد إلى شبكتك؟</div>
          <div className="text-xs text-zinc-500 mt-1 leading-relaxed">
            شغّل أمر التسجيل على أي جهاز يحتوي على كرت شاشة NVIDIA، وسيظهر هنا تلقائياً.
            لا يتطلّب بنية تحتية سحابية — جهاز، إنترنت، و كرت GPU.
          </div>
        </div>
      </div>
    </div>
  );
}

function GpuCard({ node, onPick }: { node: NodeRow; onPick: (n: NodeRow) => void }) {
  const available = node.status === "online";
  return (
    <div
      className={`group relative rounded-xl border p-5 transition-all ${
        available
          ? "border-zinc-800 bg-zinc-900/50 hover:border-emerald-500/40 hover:bg-zinc-900/70"
          : "border-zinc-800 bg-zinc-900/30 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-bold text-zinc-100 text-lg">{node.name}</h3>
          <div className="text-xs text-zinc-500 mt-0.5">{node.machine}</div>
        </div>
        <StatusPill status={node.status} />
      </div>

      <div className="space-y-2 text-sm border-t border-zinc-800 pt-4">
        <Row label="كرت الشاشة" value={node.gpu_model} mono />
        <Row
          label="الذاكرة"
          value={`${node.gpu_memory_gb} جيجابايت · GDDR6`}
        />
        <Row label="عدد الوحدات" value={`${node.gpu_count} × GPU`} />
        <Row label="الموقع" value={node.location} />
        <Row label="المالك" value={node.owner} mono />
        <Row label="آخر نبضة" value={node.last_seen_label} muted />
      </div>

      <button
        disabled={!available}
        onClick={() => onPick(node)}
        className="mt-5 w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors"
      >
        {available ? "استخدم هذا الجهاز ←" : `غير متاح (${translateStatus(node.status)})`}
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

function translateStatus(s: string): string {
  if (s === "online") return "متصل";
  if (s === "offline") return "غير متصل";
  if (s === "draining") return "قيد الإفراغ";
  return s;
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
   Phase 3: Submit form
   ================================================================== */

function SubmitView({
  node,
  image,
  setImage,
  repo,
  setRepo,
  onBack,
  onStart,
}: {
  node: NodeRow;
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
    <div className="max-w-3xl mx-auto">
      <button
        onClick={onBack}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        → العودة إلى الأجهزة
      </button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2">تشغيل مهمة تدريب</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <span>على:</span>
          <span className="inline-flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {node.name}
          </span>
          <span className="text-zinc-600">·</span>
          <span className="font-mono text-xs" dir="ltr">
            {node.gpu_model}
          </span>
          <span className="text-zinc-600">·</span>
          <span>{node.gpu_memory_gb} جيجابايت</span>
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
          🚀 ابدأ التنفيذ على {node.name}
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
   Phase 4: Running
   ================================================================== */

function RunningView({
  node,
  image,
  jobId,
  onComplete,
  onCancel,
}: {
  node: NodeRow;
  image: string;
  jobId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const systemContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startRef.current = Date.now();
    const t = setInterval(() => {
      const seconds = (Date.now() - startRef.current) / 1000;
      setElapsed(seconds);
      if (seconds >= 22.5) {
        clearInterval(t);
        setTimeout(onComplete, 900);
      }
    }, 100);
    return () => clearInterval(t);
  }, [onComplete]);

  const phase = currentPhase(elapsed);
  const pctDisplayed = Math.min(100, Math.round(phase.pct));
  const visibleLogs = MOCK_LOGS.filter((l) => l.at <= elapsed);
  const stdoutLogs = visibleLogs.filter((l) => l.stream !== "system");
  const systemLogs = visibleLogs.filter((l) => l.stream === "system");

  // Auto-scroll log panels.
  useEffect(() => {
    if (logsContainerRef.current)
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    if (systemContainerRef.current)
      systemContainerRef.current.scrollTop = systemContainerRef.current.scrollHeight;
  }, [visibleLogs.length]);

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
            <span>على:</span>
            <span className="text-emerald-400 font-medium">{node.name}</span>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-xs" dir="ltr">
              {node.gpu_model}
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

      {/* Progress bar — the demo centerpiece */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm text-zinc-300 font-medium">{phase.label}</div>
          <div className="text-3xl font-bold tabular-nums text-emerald-400" dir="ltr">
            {pctDisplayed}%
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-l from-emerald-400 via-emerald-500 to-cyan-500 transition-all duration-300 ease-out"
            style={{ width: `${pctDisplayed}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] text-zinc-500">
          <PhaseMilestone label="سحب الصورة" done={pctDisplayed >= 46} active={pctDisplayed < 46} />
          <PhaseMilestone label="بدء الحاوية" done={pctDisplayed >= 58} active={pctDisplayed >= 46 && pctDisplayed < 58} />
          <PhaseMilestone label="تحميل النموذج" done={pctDisplayed >= 72} active={pctDisplayed >= 58 && pctDisplayed < 72} />
          <PhaseMilestone label="التدريب" done={pctDisplayed >= 98} active={pctDisplayed >= 72 && pctDisplayed < 98} />
        </div>
      </div>

      {/* Highlight row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <HighlightCard label="الوقت المنقضي" value={`${elapsed.toFixed(1)} ث`} tone="info" />
        <HighlightCard label="آخر قيمة خسارة" value={latestLoss} tone="info" />
        <HighlightCard
          label="استخدام الـ GPU"
          value={elapsed > 12 ? "92٪" : elapsed > 8 ? "14٪" : "0٪"}
          tone="ok"
        />
      </div>

      {/* Two log panels */}
      <div className="grid md:grid-cols-2 gap-4 h-[420px]">
        <LogPanel
          title="مخرجات الحاوية"
          subtitle="stdout و stderr من سكربت التدريب"
          logs={stdoutLogs}
          emptyHint="في انتظار بدء الحاوية..."
          refProp={logsContainerRef}
        />
        <LogPanel
          title="نشاط المنصة"
          subtitle="أحداث سحب الصورة، دورة حياة الحاوية، رسائل المجدول"
          logs={systemLogs}
          emptyHint="لم تبدأ المهمة بعد."
          refProp={systemContainerRef}
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
  const color = done
    ? "text-emerald-400"
    : active
      ? "text-sky-400"
      : "text-zinc-600";
  const dot = done
    ? "bg-emerald-400"
    : active
      ? "bg-sky-400 animate-pulse"
      : "bg-zinc-700";
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
   Phase 5: Done
   ================================================================== */

function DoneView({
  node,
  image,
  jobId,
  onAgain,
  onHome,
}: {
  node: NodeRow;
  image: string;
  jobId: string;
  onAgain: () => void;
  onHome: () => void;
}) {
  return (
    <div className="max-w-3xl mx-auto">
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
          تم تدريب النموذج على {node.name} وحفظ محوّل LoRA بنجاح.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 mb-5">
        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-4">
          ملخّص المهمة
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <SummaryRow label="رقم المهمة" value={`#${jobId.slice(0, 8)}`} mono />
          <SummaryRow label="الحالة" value="اكتملت" tone="ok" />
          <SummaryRow label="الجهاز المستخدم" value={node.name} />
          <SummaryRow label="كرت الشاشة" value={node.gpu_model} mono />
          <SummaryRow label="المدة الفعلية" value="22.4 ثانية" mono />
          <SummaryRow label="استهلاك الذاكرة" value="4.2 / 12 جيجا" mono />
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
              محوّل LoRA محفوظ في <span className="font-mono" dir="ltr">./output</span>.
              هذا ملف صغير (2 ميجا تقريباً) يحتوي على التعديلات التي تعلّمها النموذج
              من بيانات التدريب الخاصة بك.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onAgain}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
        >
          تشغيل مهمة جديدة على نفس الجهاز
        </button>
        <button
          onClick={onHome}
          className="rounded-lg border border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/70 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors"
        >
          العودة إلى قائمة الأجهزة
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
