import { useNavigate } from 'react-router-dom';
import {
  FolderKanban, ArrowRight,
  Sparkles, Code2, Cpu, FileText, Download,
  GitBranch, Shield, MessageSquare, Zap,
  CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react';
import { getDashboardSummary } from '../../api/codegen';
import { useEffect, useState } from 'react';

/* — Gradient palettes (matching analyzer DashboardPage) — */
const G = {
  yellow: 'from-[#FFD700] via-[#FFC107] to-[#FF9800]',
  blue:   'from-[#3B82F6] via-[#2563EB] to-[#1D4ED8]',
  green:  'from-[#10B981] via-[#059669] to-[#047857]',
  purple: 'from-[#8B5CF6] via-[#7C3AED] to-[#6D28D9]',
  orange: 'from-[#F97316] via-[#EA580C] to-[#C2410C]',
  rose:   'from-[#F43F5E] via-[#E11D48] to-[#BE123C]',
  teal:   'from-[#14B8A6] via-[#0D9488] to-[#0F766E]',
  indigo: 'from-[#6366F1] via-[#4F46E5] to-[#4338CA]',
};

const FEATURES = [
  { icon: FileText,      title: 'PDD Upload & Summary', desc: 'Upload your Process Design Document and get an AI-generated summary for review.', grad: G.yellow },
  { icon: Cpu,           title: 'AI Code Generation',   desc: 'Multi-agent AI reads your spec and generates production-quality code automatically.', grad: G.blue },
  { icon: MessageSquare, title: 'Human-in-the-Loop',    desc: 'Review agent questions, provide clarifications, and guide the generation process.', grad: G.green },
  { icon: GitBranch,     title: 'Intermediate Planning', desc: 'Review high-level and low-level design plans before code generation begins.', grad: G.purple },
  { icon: Code2,         title: 'Code Viewer',          desc: 'Browse generated source code with syntax highlighting and folder tree navigation.', grad: G.orange },
  { icon: Download,      title: 'ZIP Export',           desc: 'Download the complete generated project as a ZIP file ready for your IDE.', grad: G.rose },
  { icon: Shield,        title: 'Multi-Tech Support',   desc: 'Generate Java Spring Boot, Python FastAPI, PySpark, React, Angular and more.', grad: G.teal },
  { icon: Zap,           title: 'Workspace Isolation',  desc: 'Each generation run uses its own workspace - multiple runs safely in parallel.', grad: G.indigo },
];

const STEPS = [
  { step: '01', icon: FolderKanban,  title: 'Create Workflow', desc: 'Create a code generation workflow, choose your target technology and add notes.', grad: G.yellow },
  { step: '02', icon: FileText,      title: 'Upload PDD',       desc: 'Upload your PDD or design files inside the workflow and review the summary.', grad: G.blue },
  { step: '03', icon: MessageSquare, title: 'Review & Approve', desc: 'Answer agent questions, review the intermediate plan, and approve to proceed.', grad: G.green },
  { step: '04', icon: Download,      title: 'View & Export',    desc: 'Browse generated code, download the ZIP, and deploy to your target environment.', grad: G.purple },
];

/* — Sub-components (same patterns as analyzer DashboardPage) — */
function Icon3D({ icon: Icon, gradient, size = 22, className = '' }) {
  return (
    <div className={`icon-3d flex items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} ${className}`}>
      <Icon size={size} className="text-white drop-shadow" />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, subValue, gradient }) {
  const isLong = String(value).length > 8;
  return (
    <div className="glass-card p-5 group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <p className={`font-bold text-foreground mt-1 tabular-nums leading-tight ${isLong ? 'text-base' : 'text-3xl'}`}>{value}</p>
          {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
        </div>
        <Icon3D icon={Icon} gradient={gradient} size={20} className="w-11 h-11 flex-shrink-0 group-hover:scale-110 transition-transform duration-300" />
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, grad, delay = 0 }) {
  return (
    <div className="glass-card p-6 group animate-fade-rise" style={{ animationDelay: `${delay}s` }}>
      <Icon3D icon={Icon} gradient={grad} size={20} className="w-12 h-12 mb-4 group-hover:scale-110 transition-transform duration-300" />
      <h3 className="font-semibold text-foreground mb-2 text-sm">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function StepCard({ step, icon: Icon, title, desc, grad, delay = 0 }) {
  return (
    <div className="glass-card p-6 group animate-fade-rise" style={{ animationDelay: `${delay}s` }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground border border-border shrink-0">
          {step}
        </div>
        <Icon3D icon={Icon} gradient={grad} size={15} className="w-9 h-9 shrink-0 group-hover:scale-110 transition-transform duration-300" />
      </div>
      <h3 className="font-semibold text-foreground mb-1.5 text-sm">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

/* — Page — */
export default function CodeGenDashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    getDashboardSummary().then(setSummary).catch(() => {});
  }, []);

  const total     = summary?.total ?? 0;
  const running   = summary?.running ?? 0;
  const completed = summary?.completed ?? 0;
  const pending   = summary?.pending_input ?? 0;

  return (
    <div className="dashboard-bg min-h-full overflow-y-auto">

      {/* — HERO — */}
      <section
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, hsl(240,12%,14%) 0%, hsl(240,14%,10%) 50%, hsl(38,30%,8%) 100%)' }}
      >
        <div className="pointer-events-none absolute -top-32 right-0 w-[500px] h-[500px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 w-[300px] h-[300px] rounded-full bg-primary/5 blur-[80px]" />

        <div className="relative z-10 mx-auto max-w-6xl px-8 py-14 lg:py-20 flex flex-col lg:flex-row items-center gap-12">
          {/* Left - copy */}
          <div className="flex-1 min-w-0 animate-fade-rise">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-semibold text-white/75 backdrop-blur-md mb-4">
              <Sparkles size={11} className="text-primary" />
              AI-Powered Code Generation
            </div>

            <h1 className="text-3xl md:text-4xl lg:text-[2.6rem] font-extrabold text-white leading-[1.12] tracking-tight">
              <span className="font-sans">EUC Code</span><br />
              <em className="font-serif not-italic font-normal text-primary">Generation</em>
            </h1>

            <p className="mt-3 text-sm text-white font-medium">
              CodeGen Module of EUC RAID
            </p>

            <p className="mt-5 text-base text-white/60 max-w-md leading-relaxed">
              Transform Process Design Documents into{' '}
              <strong className="text-white/80 font-medium">production-quality code</strong>{' '}
              automatically. AI agents handle scaffolding, logic, tests, and configuration.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/codegen/workflows')}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 shadow-lg hover:shadow-primary/25 hover:scale-[1.02]"
              >
                Get Started <ArrowRight size={15} />
              </button>
            </div>
          </div>

          {/* Right - hero illustration */}
          <div className="relative w-full max-w-[480px] mx-auto">
            <div className="absolute inset-x-8 bottom-0 h-16 bg-primary/20 blur-2xl rounded-full" />
            <div className="relative z-10 rounded-2xl border border-white/12 bg-white/6 backdrop-blur-md shadow-2xl overflow-hidden animate-float">
              <div className="flex items-center gap-1.5 px-4 py-3 bg-white/6 border-b border-white/10">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
                <span className="ml-2 text-[10px] text-white/40 font-mono tracking-wide">CodeGen Engine</span>
              </div>
              <div className="p-5 space-y-3">
                {/* File structure preview */}
                <div className="flex items-center gap-2.5">
                  <Icon3D icon={Code2} gradient={G.blue} size={14} className="w-8 h-8" />
                  <div className="flex-1 min-w-0">
                    <div className="h-2 w-24 rounded bg-white/25" />
                    <div className="mt-1 h-1.5 w-16 rounded bg-white/12" />
                  </div>
                </div>
                {[85, 65, 75, 55, 45].map((w, i) => (
                  <div key={i} className="h-1.5 rounded bg-white/10" style={{ width: `${w}%` }} />
                ))}
                <div className="mt-2 flex items-end gap-1.5 h-12">
                  {[40, 65, 55, 80, 70, 90].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t"
                      style={{ height: `${h}%`, background: i === 5 ? 'hsl(52 100% 50%)' : `rgba(255,215,0,${0.25 + i * 0.07})` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="absolute -bottom-4 -right-4 z-20 glass-card flex items-center gap-2 px-3 py-2 animate-float-slow">
              <Icon3D icon={Zap} gradient={G.yellow} size={11} className="w-6 h-6 flex-shrink-0" />
              <span className="text-xs font-semibold text-foreground whitespace-nowrap">Code Ready</span>
            </div>
            <div className="absolute -top-4 -left-4 z-20 glass-card flex items-center gap-2 px-3 py-2 animate-float" style={{ animationDelay: '1s' }}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
              <span className="text-xs font-semibold text-foreground whitespace-nowrap">Agent Active</span>
            </div>
          </div>
        </div>
      </section>

      {/* — STATS — */}
      <section className="mx-auto max-w-6xl px-8 -mt-6 relative z-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={FolderKanban}  label="Total Workflows" value={total}     gradient={G.yellow} />
          <StatCard icon={Loader2}        label="Running"         value={running}   gradient={G.blue} />
          <StatCard icon={CheckCircle2}  label="Code Generated"  value={completed} gradient={G.green} />
          <StatCard icon={AlertCircle}   label="Pending Input"   value={pending}   gradient={G.orange} />
        </div>
      </section>

      {/* — HOW IT WORKS — */}
      <section className="mx-auto max-w-6xl px-8 py-12">
        <h2 className="text-lg font-bold text-foreground mb-1 animate-fade-rise">How It Works</h2>
        <p className="text-sm text-muted-foreground mb-6 animate-fade-rise" style={{ animationDelay: '.05s' }}>
          Four steps from PDD to production code.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <StepCard key={s.step} {...s} delay={i * 0.08} />
          ))}
        </div>
      </section>

      {/* — FEATURES — */}
      <section className="mx-auto max-w-6xl px-8 pb-16">
        <h2 className="text-lg font-bold text-foreground mb-1 animate-fade-rise">Capabilities</h2>
        <p className="text-sm text-muted-foreground mb-6 animate-fade-rise" style={{ animationDelay: '.05s' }}>
          Everything you need to generate code from specifications.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} {...f} delay={i * 0.06} />
          ))}
        </div>
      </section>

    </div>
  );
}