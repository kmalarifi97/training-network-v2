import Link from "next/link";

/* ==================================================================
   Landing — public marketing page at "/"
   Salad-flavored dark theme · Arabic RTL
   ================================================================== */

export default function Landing() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <DualAudience />
      </main>
      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                             */
/* ------------------------------------------------------------------ */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[rgba(237,232,208,0.78)] border-b border-border">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 h-16 flex items-center justify-between gap-8">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Logo />
          <span className="font-semibold text-[0.95rem] tracking-tight">
            شبكة <span className="mono">GPU</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-hi">
          <a href="#how" className="hover:text-foreground transition-colors">
            كيف تعمل؟
          </a>
          <a href="#audience" className="hover:text-foreground transition-colors">
            للمستخدمين والمستضيفين
          </a>
          <a href="/app" className="hover:text-foreground transition-colors">
            الوثائق
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="hidden sm:inline-flex text-sm text-muted-hi hover:text-foreground transition-colors"
          >
            دخول
          </Link>
          <Link href="/app" className="btn-primary text-sm">
            ابدأ الآن
            <ArrowIcon />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
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

function ArrowIcon() {
  // In RTL the arrow points leftward (toward reading direction's "forward").
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      style={{ transform: "scaleX(-1)" }}
    >
      <path
        d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                               */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="hero-grid relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-14 pb-16 lg:pt-20 lg:pb-20 grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-6 flex flex-col gap-6">
          <span className="pill w-fit">
            <span className="pulse-dot" />
            الإصدار التجريبي · مفتوح للأصدقاء
          </span>

          <h1 className="display-tight text-[2.3rem] sm:text-[2.7rem] lg:text-[3.15rem] leading-[1.1] font-bold">
            شبكة معالجات موزعة،
            <br />
            <span className="text-accent">مبنية محليا.</span>
          </h1>

          <div className="flex flex-col gap-3 text-lg text-muted-hi leading-[1.6] max-w-[56ch]">
            <p className="flex items-center gap-3">
              <span
                aria-hidden
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: "var(--accent)" }}
              />
              <span>عالج بياناتك في بيئة تتوافق مع الأنظمة.</span>
            </p>
            <p className="flex items-center gap-3">
              <span
                aria-hidden
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: "var(--accent)" }}
              />
              <span>اربح من معالجك وقت الفراغ.</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link href="/app" className="btn-primary">
              ابدأ الآن
              <ArrowIcon />
            </Link>
          </div>

          <div className="flex items-center gap-6 pt-6 text-xs text-muted">
            <span className="flex items-center gap-2">
              <CheckIcon /> <span>عزل كامل للحاويات</span>
            </span>
            <span className="flex items-center gap-2">
              <CheckIcon /> <span>بدون وصول <span className="mono">SSH</span></span>
            </span>
            <span className="flex items-center gap-2">
              <CheckIcon /> <span>واجهة + <span className="mono">API</span> + <span className="mono">CLI</span></span>
            </span>
          </div>
        </div>

        <div className="lg:col-span-6">
          <TerminalMock />
        </div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="var(--accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Terminal mock — shown LTR even inside RTL page. */
function TerminalMock() {
  return (
    <div className="terminal accent-ring overflow-hidden" dir="ltr">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border">
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        <span className="mx-auto text-xs text-muted mono select-none">
          gpunet — ~/projects/finetune-demo
        </span>
      </div>

      <pre className="mono text-[12.5px] leading-[1.75] p-5 text-muted-hi whitespace-pre overflow-x-auto">
        <span className="text-accent">$</span> gpunet nodes marketplace
        {"\n"}
        <span className="text-muted">┌────────────────┬────────────┬──────────┬────────┐</span>
        {"\n"}
        <span className="text-muted">│</span> <span className="text-foreground">node</span>           <span className="text-muted">│</span> <span className="text-foreground">host</span>       <span className="text-muted">│</span> <span className="text-foreground">gpu</span>      <span className="text-muted">│</span> <span className="text-foreground">status</span> <span className="text-muted">│</span>
        {"\n"}
        <span className="text-muted">├────────────────┼────────────┼──────────┼────────┤</span>
        {"\n"}
        <span className="text-muted">│</span> riyadh-a100    <span className="text-muted">│</span> @ahmad.ml  <span className="text-muted">│</span> A100-80G <span className="text-muted">│</span> <span className="text-accent">● on</span>   <span className="text-muted">│</span>
        {"\n"}
        <span className="text-muted">│</span> jeddah-rtx4090 <span className="text-muted">│</span> @noura.dev <span className="text-muted">│</span> RTX 4090 <span className="text-muted">│</span> <span className="text-accent">● on</span>   <span className="text-muted">│</span>
        {"\n"}
        <span className="text-muted">│</span> dammam-h100    <span className="text-muted">│</span> @fahad.io  <span className="text-muted">│</span> H100-80G <span className="text-muted">│</span> <span className="text-accent">● on</span>   <span className="text-muted">│</span>
        {"\n"}
        <span className="text-muted">└────────────────┴────────────┴──────────┴────────┘</span>
        {"\n\n"}
        <span className="text-accent">$</span> gpunet jobs submit \{"\n"}
        {"    "}--image <span className="text-[#ffd866]">kmalarifi/llm-finetune:v1</span> \{"\n"}
        {"    "}--cmd <span className="text-[#ffd866]">"python train.py --epochs 3"</span> \{"\n"}
        {"    "}--node riyadh-a100
        {"\n"}
        queued <span className="text-accent">→</span> <span className="text-foreground">job-7b3e2f1a</span>
        {"\n\n"}
        <span className="text-accent">$</span> gpunet jobs logs job-7b3e2f1a --follow
        {"\n"}
        <span className="text-muted">[step 1/100]</span> loss=2.4213
        {"\n"}
        <span className="text-muted">[step 2/100]</span> loss=2.3887
        {"\n"}
        <span className="text-muted">[step 3/100]</span> loss=2.3541  <span className="text-accent">✓ checkpoint</span>
        {"\n"}
        <span className="text-muted">[step 4/100]</span> loss=<span className="animate-pulse">2.3_</span>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                       */
/* ------------------------------------------------------------------ */

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "اختر معالج",
      body:
        "تصفح السوق. شاهد نوع GPU، عدد الذاكرة، واسم المالك. اختر المعالج المناسب لعملك.",
    },
    {
      n: "02",
      title: "أرسل حاوية",
      body:
        "صورة Docker + أمر تشغيل + عدد GPUs. المنصة تسحب الصورة، تشغل الحاوية بعزل كامل، وتعيد المخرجات لك.",
    },
    {
      n: "03",
      title: "راقب السجلات",
      body:
        "بث مباشر للسجلات، تنبيهات الحالة، وإلغاء فوري. ما يخرج من الحاوية هو ما يصل إليك — بدون وسطاء.",
    },
  ];

  return (
    <section id="how" className="py-14 lg:py-20 border-y border-border">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <SectionHeader
          eyebrow="كيف تعمل؟"
          title={
            <>
              ثلاث خطوات.
              <br />
              <span className="text-accent">من الصفر حتى التدريب.</span>
            </>
          }
          sub="منصة حاويات رفيعة. لا افتراضات عن عملك، لا قوالب، لا قيود على بيئة التشغيل."
        />

        <div className="mt-10 lg:mt-12 grid md:grid-cols-3 gap-5">
          {steps.map((s) => (
            <div key={s.n} className="card p-7 flex flex-col gap-4">
              <span className="mono text-muted text-sm tracking-wider">{s.n}</span>
              <h3 className="text-xl font-semibold">{s.title}</h3>
              <p className="text-muted-hi leading-[1.8] text-[0.95rem]">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Dual audience                                                      */
/* ------------------------------------------------------------------ */

function DualAudience() {
  return (
    <section id="audience" className="py-14 lg:py-20">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <SectionHeader
          eyebrow="من يستخدم الشبكة؟"
          title={
            <>
              جانبان من سوق واحد.
              <br />
              <span className="text-accent">يلتقيان في حاوية.</span>
            </>
          }
        />

        <div className="mt-10 lg:mt-12 grid md:grid-cols-2 gap-5">
          <AudienceCard
            kind="renter"
            title="للباحثين والمطورين"
            subtitle="شغل تدريبك، استنتاجك، وتجاربك على GPU محلية — بدون إعداد بنية تحتية."
            bullets={[
              "واجهة عربية + CLI + API",
              "تسعير بالساعة، بدون التزامات",
              "سجلات مباشرة وإلغاء فوري",
              "متوافق مع أي صورة Docker",
            ]}
            cta={{ label: "ابدأ الآن", href: "/app" }}
          />
          <AudienceCard
            kind="host"
            title="لمالكي الأجهزة"
            subtitle="سجل جهاز GPU خاصتك واكسب مقابل الوقت الخامل. تركيب دقيقة واحدة."
            bullets={[
              "رمز تسجيل لمرة واحدة",
              "عزل حاويات كامل — لا SSH، لا وصول دائم",
              "إيقاف مؤقت متى شئت",
              "هويتك مرئية: العملاء يختارونك بالاسم",
            ]}
            cta={{ label: "استضف معالج", href: "/app" }}
          />
        </div>
      </div>
    </section>
  );
}

function AudienceCard({
  kind,
  title,
  subtitle,
  bullets,
  cta,
}: {
  kind: "renter" | "host";
  title: string;
  subtitle: string;
  bullets: string[];
  cta: { label: string; href: string };
}) {
  return (
    <article
      className={`card p-8 lg:p-10 flex flex-col gap-6 ${
        kind === "renter" ? "" : "dot-pattern"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${
            kind === "renter"
              ? "bg-[var(--accent-dim)] text-accent"
              : "bg-[var(--surface-hi)] text-muted-hi border border-border-hi"
          }`}
        >
          {kind === "renter" ? <RenterIcon /> : <HostIcon />}
        </span>
        <h3 className="text-2xl font-semibold">{title}</h3>
      </div>
      <p className="text-muted-hi leading-[1.8]">{subtitle}</p>
      <ul className="flex flex-col gap-3 mt-2">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-[0.95rem]">
            <span className="mt-[7px] shrink-0">
              <CheckIcon />
            </span>
            <span className="text-muted-hi">{b}</span>
          </li>
        ))}
      </ul>
      <div className="pt-3">
        <Link
          href={cta.href}
          className={kind === "renter" ? "btn-primary" : "btn-secondary"}
        >
          {cta.label}
          <ArrowIcon />
        </Link>
      </div>
    </article>
  );
}

function RenterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M3 9L9 3L15 9L9 15L3 9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

function HostIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="12"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M6 14H12M9 11V14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="6" cy="7.5" r="0.9" fill="currentColor" />
      <circle cx="9" cy="7.5" r="0.9" fill="currentColor" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Section header                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <span className="text-accent text-sm font-medium tracking-wide">
        {eyebrow}
      </span>
      <h2 className="display-tight text-[2.15rem] lg:text-[2.95rem] font-bold leading-[1.15]">
        {title}
      </h2>
      {sub && (
        <p className="text-lg text-muted-hi leading-[1.8] max-w-2xl">{sub}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                             */
/* ------------------------------------------------------------------ */

function SiteFooter() {
  const cols: { title: string; links: { label: string; href: string }[] }[] = [
    {
      title: "المنصة",
      links: [
        { label: "الميزات", href: "#why" },
        { label: "كيف تعمل", href: "#how" },
        { label: "للمستضيفين", href: "#audience" },
      ],
    },
    {
      title: "المطورون",
      links: [
        { label: "الوثائق", href: "/app" },
        { label: "CLI", href: "/app" },
        { label: "API", href: "/app" },
      ],
    },
    {
      title: "الشبكة",
      links: [
        { label: "المسؤولون", href: "/app" },
        { label: "المساهمون", href: "/app" },
        { label: "تواصل معنا", href: "/app" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16 grid md:grid-cols-4 gap-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="font-semibold tracking-tight">
              شبكة <span className="mono">GPU</span>
            </span>
          </div>
          <p className="text-sm text-muted leading-[1.8] max-w-xs">
            شبكة وحدات معالجة رسومية موزعة داخل المملكة. مفتوحة المصدر.
          </p>
        </div>

        {cols.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold">{col.title}</h4>
            <ul className="flex flex-col gap-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="text-sm text-muted hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-6 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-muted">
            © 2026 شبكة <span className="mono">GPU</span> — كل الحقوق محفوظة.
          </span>
          <div className="flex items-center gap-5 text-xs text-muted">
            <a href="#" className="hover:text-foreground transition-colors">
              الخصوصية
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              شروط الاستخدام
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
