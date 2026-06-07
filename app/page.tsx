"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import {
  commitReport,
  fetchRecords,
  type PatientRecord,
} from "./firebase";
// Since your file is at app/utils/gemini.ts, 
// and page.tsx is at app/page.tsx, this is the exact relative path:
import { analyzeNutrition, analyzeVision, askGemini, type ChatTurn, type NutriReport, type VisionReport } from "./utils/gemini";

type AppState = "LANDING" | "PROCESSING" | "VISION" | "NUTRI" | "CURE";

// ---------------------------------------------------------------------------
// Treatment plan generator (deterministic, clinical, per diagnosis)
// ---------------------------------------------------------------------------
type TreatmentPlan = {
  am: { step: string; product: string; note: string }[];
  pm: { step: string; product: string; note: string }[];
  oral: { name: string; dose: string; purpose: string }[];
  hydration: string[];
  lifestyle: string[];
};

function buildTreatmentPlan(classification: string): TreatmentPlan {
  const c = classification.toLowerCase();
  const isAcne = c.includes("acne") || c.includes("pimple");
  const isMelasma = c.includes("melasma") || c.includes("pigment");
  const isDermatitis = c.includes("dermatitis") || c.includes("eczema") || c.includes("contact");
  const isSeb = c.includes("seborrheic");

  const base = {
    am: [
      { step: "01 · Cleanse", product: "Gentle, non-foaming cleanser (pH 5.5)", note: "Lukewarm water, 30 seconds." },
      { step: "02 · Treat", product: "Niacinamide 5% + Zinc 1% serum", note: "Reduces sebum and erythema." },
      { step: "03 · Moisturize", product: "Ceramide-based gel moisturizer", note: "Locks in barrier hydration." },
      { step: "04 · Protect", product: "Broad-spectrum SPF 50, PA++++", note: "Reapply every 2–3 hrs outdoors." },
    ],
    pm: [
      { step: "01 · Double Cleanse", product: "Oil cleanser → gentle foaming cleanser", note: "Remove SPF + sebum." },
      { step: "02 · Active", product: "Adapalene 0.1% (pea-sized)", note: "Start 2×/week, build to nightly." },
      { step: "03 · Moisturize", product: "Barrier repair cream (ceramides + cholesterol)", note: "Buffer over retinoid if needed." },
    ],
    oral: [
      { name: "Omega-3 (EPA/DHA)", dose: "1000 mg daily", purpose: "Anti-inflammatory baseline." },
      { name: "Zinc picolinate", dose: "25 mg daily", purpose: "Supports barrier + sebaceous regulation." },
      { name: "Vitamin D3", dose: "1000–2000 IU daily", purpose: "Immune modulation; common deficiency." },
      { name: "Probiotic (multi-strain)", dose: "10–20B CFU daily", purpose: "Gut-skin axis support." },
    ],
    hydration: [
      "2.5 – 3.0 L of water per day, split across 8 glasses.",
      "Include 1 glass of coconut water or ORS twice a week for electrolytes.",
      "Limit caffeine to 2 cups/day; avoid alcohol during flares.",
    ],
    lifestyle: [
      "Change pillowcases every 2–3 days.",
      "Avoid touching face; sanitize phone screen daily.",
      "7–8 hrs sleep; keep bedroom cool (18–20 °C).",
      "30 min moderate exercise 4×/week for cortisol control.",
    ],
  };

  if (isAcne) {
    base.am[1] = { step: "02 · Treat", product: "Benzoyl Peroxide 2.5% (spot) + Niacinamide 5%", note: "Targets C. acnes without over-drying." };
    base.pm[1] = { step: "02 · Active", product: "Adapalene 0.1% gel (pea-sized, full face)", note: "Gold standard for comedonal + inflammatory acne." };
  } else if (isMelasma) {
    base.am[1] = { step: "02 · Treat", product: "Tranexamic Acid 3% + Vitamin C 10%", note: "Targets melanogenesis pathway." };
    base.pm[1] = { step: "02 · Active", product: "Azelaic Acid 15–20% cream", note: "Tyrosinase inhibitor, safe long-term." };
    base.am[3] = { step: "04 · Protect", product: "Tinted mineral SPF 50 (iron oxide)", note: "Blocks visible light, crucial for melasma." };
  } else if (isDermatitis) {
    base.am[1] = { step: "02 · Treat", product: "Colloidal oatmeal + panthenol serum", note: "Soothes, reduces TEWL." };
    base.pm[1] = { step: "02 · Active", product: "Hydrocortisone 1% (thin layer, 5–7 days)", note: "Short course only; taper with ceramides." };
  } else if (isSeb) {
    base.am[1] = { step: "02 · Treat", product: "Ketoconazole 2% cream (affected zones)", note: "Antifungal; targets Malassezia." };
    base.pm[1] = { step: "02 · Active", product: "Zinc Pyrithione cleanser 3×/week", note: "Alternate with gentle cleanser." };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
function DisclaimerBar() {
  const text =
    "⚠ MEDICAL DISCLAIMER: AI-GENERATED ANALYSIS IS NOT A SUBSTITUTE FOR PROFESSIONAL MEDICAL DIAGNOSIS. CONSULT A BOARD-CERTIFIED DERMATOLOGIST.   ·   ";
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-red-500/60 bg-red-600 text-white shadow-[0_-10px_40px_-10px_rgba(239,68,68,0.55)]">
      <div className="flex items-stretch">
        <div className="shrink-0 bg-red-700 px-4 py-3 font-black tracking-wider text-[11px] sm:text-xs">
          🔴 CRITICAL
        </div>
        <div className="relative flex-1 overflow-hidden py-3">
          <div className="marquee-track flex whitespace-nowrap text-[12px] sm:text-sm font-bold tracking-wide">
            <span className="px-2">{text.repeat(10)}</span>
            <span className="px-2" aria-hidden>{text.repeat(10)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ state }: { state: AppState }) {
  const steps: { id: AppState; label: string }[] = [
    { id: "LANDING", label: "Intake" },
    { id: "PROCESSING", label: "Scan" },
    { id: "VISION", label: "DermVision" },
    { id: "NUTRI", label: "DermNutri" },
    { id: "CURE", label: "DermCure" },
  ];
  const activeIdx = steps.findIndex((s) => s.id === state);
  return (
    <div className="fixed top-0 inset-x-0 z-40 border-b border-cyan-400/15 bg-[#04060b]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="relative h-8 w-8">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 blur-sm opacity-80" />
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full border border-cyan-300/60 bg-[#060a13] text-cyan-300 font-black">
              D
            </div>
          </div>
          <div>
            <div className="text-sm font-black tracking-[0.35em] text-cyan-200 neon-text">
              DERMLENS
            </div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Clinical AI · v3.1
            </div>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2">
          {steps.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <div key={s.id} className="flex items-center">
                <div
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase transition ${
                    active
                      ? "border-cyan-300/70 bg-cyan-400/10 text-cyan-200 shadow-[0_0_18px_-4px_rgba(34,211,238,0.6)]"
                      : done
                      ? "border-slate-600/60 bg-slate-800/40 text-slate-300"
                      : "border-slate-700/50 bg-transparent text-slate-500"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                      active
                        ? "bg-cyan-400 text-slate-950"
                        : done
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  {s.label}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`mx-1 h-px w-6 ${
                      done ? "bg-cyan-400/60" : "bg-slate-700"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          SYSTEM ONLINE
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DNA Helix background
// ---------------------------------------------------------------------------
function DnaHelixBackground() {
  const rungs = Array.from({ length: 28 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 cyber-grid opacity-60" />
      <div className="absolute inset-0 flex items-center justify-center helix-stage opacity-[0.35]">
        <div className="helix-drift">
          <div className="relative h-[1100px] w-[200px] helix">
            {rungs.map((_, i) => {
              const angle = (i / rungs.length) * 720; // two full twists
              const top = (i / rungs.length) * 100;
              return (
                <div
                  key={i}
                  className="helix-rung"
                  style={{
                    top: `${top}%`,
                    transform: `rotateY(${angle}deg) translateZ(0px)`,
                    opacity: 0.45 + (i % 3) * 0.15,
                  }}
                >
                  <span className="helix-node" style={{ left: 0 }} />
                  <span className="helix-node v" style={{ right: 0 }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Floating particles */}
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="absolute h-1 w-1 rounded-full bg-cyan-300/60"
          style={{
            top: `${(i * 37) % 100}%`,
            left: `${(i * 53) % 100}%`,
            boxShadow: "0 0 10px rgba(34,211,238,0.7)",
            animation: `blink ${2 + (i % 4)}s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LANDING
// ---------------------------------------------------------------------------
function LandingPage({
  onUpload,
  onStart,
  imageDataUrl,
  fileName,
}: {
  onUpload: (dataUrl: string, name: string) => void;
  onStart: () => void;
  imageDataUrl: string | null;
  fileName: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [vaultOpen, setVaultOpen] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onUpload(reader.result, f.name);
      }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="relative min-h-screen pt-28 pb-28">
      <DnaHelixBackground />

      <div className="relative mx-auto max-w-5xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          className="text-center"
        >
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.4em] text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Multi-Agent Dermatology OS
          </div>
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tight leading-[0.95]">
            <span className="bg-gradient-to-b from-white via-slate-200 to-slate-500 bg-clip-text text-transparent">
              DERMLENS
            </span>
          </h1>
          <p className="mt-4 text-sm sm:text-base uppercase tracking-[0.35em] text-cyan-300/80 neon-text">
            Clinical Risk Assessment
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-slate-400 text-base sm:text-lg leading-relaxed">
            Upload a skin scan. Three specialized AI agents —{" "}
            <span className="text-cyan-300 font-semibold">DermVision</span>,{" "}
            <span className="text-violet-300 font-semibold">DermNutri</span>, and{" "}
            <span className="text-emerald-300 font-semibold">DermCure</span> — will
            deliver a board-level diagnostic, dietary, and therapeutic brief.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.8 }}
          className="mx-auto mt-12 max-w-2xl glass rounded-3xl p-6 sm:p-8 clip-corner"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono uppercase tracking-[0.3em] text-cyan-300">
              // intake_module
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              AES-256 · HIPAA-SIM
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-5">
            {/* Upload tile */}
            <div className="sm:col-span-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="group relative flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-cyan-400/30 bg-cyan-400/[0.03] p-6 transition hover:border-cyan-300/70 hover:bg-cyan-400/[0.07]"
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                />
                {imageDataUrl ? (
                  <>
                    <img
                      src={imageDataUrl}
                      alt="Uploaded skin scan"
                      className="h-32 w-32 rounded-xl border border-cyan-300/50 object-cover shadow-[0_0_30px_-8px_rgba(34,211,238,0.8)]"
                    />
                    <div className="text-xs font-mono text-slate-400 truncate max-w-full">
                      {fileName}
                    </div>
                    <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                      ↻ Replace scan
                    </div>
                  </>
                ) : (
                  <>
                    <div className="relative h-16 w-16">
                      <div className="absolute inset-0 rounded-full border-2 border-cyan-400/40" />
                      <div className="absolute inset-0 flex items-center justify-center text-3xl text-cyan-300 group-hover:scale-110 transition">
                        ⬆
                      </div>
                      <div className="absolute inset-0 rounded-full pulse-ring border-2 border-cyan-400/40" />
                    </div>
                    <div className="text-base font-bold text-slate-100">
                      Upload Skin Scan
                    </div>
                    <div className="text-xs text-slate-500">
                      JPG · PNG · HEIC · up to 10 MB
                    </div>
                  </>
                )}
              </button>
            </div>

            {/* Actions */}
            <div className="sm:col-span-2 flex flex-col gap-3">
              <button
                disabled={!imageDataUrl}
                onClick={onStart}
                className={`btn-shine relative flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-sm font-black uppercase tracking-[0.2em] transition ${
                  imageDataUrl
                    ? "bg-gradient-to-br from-cyan-400 to-cyan-600 text-slate-950 shadow-[0_10px_40px_-10px_rgba(34,211,238,0.8)] hover:brightness-110"
                    : "bg-slate-800/60 text-slate-500 cursor-not-allowed border border-slate-700/60"
                }`}
              >
                <span>Start Analysis</span>
                <span>→</span>
              </button>
              <button
                onClick={() => setVaultOpen(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] text-violet-200 transition hover:bg-violet-500/15 hover:border-violet-300/60"
              >
                <span>🔒</span>
                <span>Secure Database Vault</span>
              </button>
              <div className="text-[10px] font-mono text-slate-500 leading-relaxed mt-1">
                Vault access requires authorization. All records are
                end-to-end encrypted.
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-700/50 pt-5">
            {[
              { k: "SCANS", v: "128K" },
              { k: "AGENTS", v: "3" },
              { k: "ACCURACY", v: "94.7%" },
            ].map((s) => (
              <div key={s.k} className="text-center">
                <div className="text-xl sm:text-2xl font-black text-cyan-200 neon-text">
                  {s.v}
                </div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 mt-1">
                  {s.k}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 1 }}
          className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {[
            { t: "DermVision", d: "Computer-vision lesion classification with confidence scoring.", c: "text-cyan-300" },
            { t: "DermNutri", d: "48-hour diet audit tailored to your specific diagnosis.", c: "text-violet-300" },
            { t: "DermCure", d: "AM/PM protocol, oral stack, and live clinical chatbot.", c: "text-emerald-300" },
          ].map((a) => (
            <div key={a.t} className="glass rounded-2xl p-4">
              <div className={`text-[11px] font-black uppercase tracking-[0.3em] ${a.c}`}>
                Agent · {a.t}
              </div>
              <div className="mt-2 text-sm text-slate-300">{a.d}</div>
            </div>
          ))}
        </motion.div>
      </div>

      <VaultModal open={vaultOpen} onClose={() => setVaultOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vault Modal
// ---------------------------------------------------------------------------
function VaultModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [records, setRecords] = useState<PatientRecord[] | null>(null);

  useEffect(() => {
    if (!open) {
      setPwd("");
      setErr("");
      setRecords(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwd === "report123") {
      const recs = await fetchRecords();
      setRecords(recs.slice(0, 5));
      setErr("");
    } else {
      setErr("ACCESS DENIED — invalid clearance code.");
    }
  };

  if (!open) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="glass neon-border-violet w-full max-w-3xl rounded-3xl p-6 sm:p-8"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.4em] text-violet-300">
              // dermlens_vault
            </div>
            <div className="mt-1 text-2xl font-black text-slate-100">
              Secure Patient Records
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            ✕ Close
          </button>
        </div>

        {!records ? (
          <form onSubmit={submit} className="mt-8">
            <label className="block text-xs uppercase tracking-[0.3em] text-slate-400 font-mono">
              Authorization Code
            </label>
            <input
              autoFocus
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="••••••••"
              className="cli-input mt-2 w-full rounded-xl px-4 py-3 text-lg"
            />
            {err && (
              <div className="mt-3 text-sm font-semibold text-red-400">
                {err}
              </div>
            )}
            <div className="mt-2 text-[11px] font-mono text-slate-500">
              Hint for demo: <span className="text-cyan-300">report123</span>
            </div>
            <button
              type="submit"
              className="mt-5 w-full rounded-xl bg-gradient-to-br from-violet-400 to-violet-600 py-3 text-sm font-black uppercase tracking-[0.3em] text-slate-950 hover:brightness-110"
            >
              Authenticate →
            </button>
          </form>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-700/60">
            <div className="grid grid-cols-12 gap-2 border-b border-slate-700/60 bg-slate-900/60 px-4 py-2 text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400">
              <div className="col-span-2">ID</div>
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Age</div>
              <div className="col-span-3">Classification</div>
              <div className="col-span-2 text-right">Risk</div>
            </div>
            {records.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-12 gap-2 items-center border-b border-slate-800/60 px-4 py-3 text-sm hover:bg-slate-800/40 transition"
              >
                <div className="col-span-2 font-mono text-[11px] text-cyan-300">{r.id}</div>
                <div className="col-span-3 font-semibold text-slate-200">{r.name}</div>
                <div className="col-span-2 text-slate-400">{r.age}</div>
                <div className="col-span-3 text-slate-300 truncate">{r.classification}</div>
                <div className="col-span-2 text-right">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-black ${
                      r.riskScore >= 7.5
                        ? "bg-red-500/15 text-red-300 border border-red-500/40"
                        : r.riskScore >= 5
                        ? "bg-amber-500/15 text-amber-300 border border-amber-500/40"
                        : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                    }`}
                  >
                    {r.riskScore.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// PROCESSING
// ---------------------------------------------------------------------------
const TERMINAL_LOGS = [
  "[SYS] Booting DermLens inference kernel v3.1.0 …",
  "[SYS] Loading convolutional weights · 128M params …",
  "[SYS] Scanning epidermal layers …",
  "[SYS] Identifying lesion classifications …",
  "[SYS] Mapping vascular irregularities …",
  "[SYS] Cross-referencing Fitzpatrick phototype …",
  "[SYS] Finding dermatological root causes …",
  "[SYS] Calibrating risk model against 2.4M clinical records …",
  "[OK ] Vision pipeline complete · compiling DermVision report …",
];

function ProcessingPage({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      for (const line of TERMINAL_LOGS) {
        if (!mounted) return;
        setTyped("");
        for (let i = 1; i <= line.length; i++) {
          if (!mounted) return;
          setTyped(line.slice(0, i));
          await new Promise((r) => setTimeout(r, 18));
        }
        setLines((prev) => [...prev, line]);
        setTyped("");
        await new Promise((r) => setTimeout(r, 120));
      }
    };
    run();
    const t = setTimeout(() => {
      if (mounted) onDone();
    }, 3000);
    return () => {
      mounted = false;
      clearTimeout(t);
    };
  }, [onDone]);

  const progress = Math.min(100, (lines.length / TERMINAL_LOGS.length) * 100);

  return (
    <div className="relative min-h-screen pt-28 pb-28">
      <DnaHelixBackground />
      <div className="relative mx-auto max-w-3xl px-5">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="glass neon-border rounded-3xl overflow-hidden clip-corner"
        >
          <div className="flex items-center justify-between border-b border-cyan-400/20 bg-[#05080f] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-3 text-xs font-mono text-slate-400">
                dermlens@inference ~ /vision_pipeline
              </span>
            </div>
            <span className="text-[10px] font-mono text-cyan-300 animate-pulse">
              ● LIVE
            </span>
          </div>

          <div className="relative scanlines bg-[#03060c] p-5 sm:p-7 h-[380px] sm:h-[440px] overflow-hidden">
            <div className="font-mono text-[13px] leading-6 text-emerald-300">
              {lines.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  <span className="text-slate-500">{String(i + 1).padStart(2, "0")} </span>
                  <span>{l}</span>
                </div>
              ))}
              {typed && (
                <div className="whitespace-pre-wrap">
                  <span className="text-slate-500">{String(lines.length + 1).padStart(2, "0")} </span>
                  <span>{typed}</span>
                  <span className="cursor" />
                </div>
              )}
            </div>
          </div>

          <div className="px-4 sm:px-7 py-4 border-t border-cyan-400/20 bg-[#05080f]">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>PROGRESS</span>
              <span className="text-cyan-300">{progress.toFixed(0)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-800/80 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-400 via-violet-400 to-emerald-400"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-slate-500">
              <span className="text-emerald-400">● GPU 0 · 94% util</span>
              <span>·</span>
              <span>VRAM 11.2 / 24 GB</span>
              <span>·</span>
              <span>Latency 38ms</span>
            </div>
          </div>
        </motion.div>

        <div className="mt-8 text-center text-sm text-slate-400">
          Please do not close this window — agents are synthesizing your report.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Dial
// ---------------------------------------------------------------------------
function RiskDial({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(10, value));
  const pct = clamped / 10;
  const angle = -135 + pct * 270; // -135 to +135
  const label =
    clamped < 3.5 ? "LOW" : clamped < 6.5 ? "MODERATE" : clamped < 8.5 ? "HIGH" : "CRITICAL";
  const color =
    clamped < 3.5
      ? "text-emerald-300"
      : clamped < 6.5
      ? "text-amber-300"
      : clamped < 8.5
      ? "text-orange-300"
      : "text-red-400";

  return (
    <div className="relative mx-auto h-56 w-56">
      <svg viewBox="0 0 200 200" className="h-full w-full">
        <defs>
          <linearGradient id="dialGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        {/* track */}
        <path
          d="M 30 150 A 80 80 0 1 1 170 150"
          fill="none"
          stroke="#1a2336"
          strokeWidth="18"
          strokeLinecap="round"
        />
        {/* fill */}
        <path
          d="M 30 150 A 80 80 0 1 1 170 150"
          fill="none"
          stroke="url(#dialGrad)"
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${pct * 377} 999`}
        />
        {/* ticks */}
        {Array.from({ length: 11 }).map((_, i) => {
          const a = (-135 + (i / 10) * 270) * (Math.PI / 180);
          const x1 = 100 + Math.cos(a) * 68;
          const y1 = 100 + Math.sin(a) * 68;
          const x2 = 100 + Math.cos(a) * 60;
          const y2 = 100 + Math.sin(a) * 60;
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth="1.5" />
          );
        })}
        {/* needle */}
        <g transform={`rotate(${angle} 100 100)`}>
          <line x1="100" y1="100" x2="100" y2="38" stroke="#e6edf7" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="100" r="8" fill="#0b1220" stroke="#22d3ee" strokeWidth="2" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-4 text-center">
        <div className="text-4xl font-black text-white neon-text">
          {clamped.toFixed(1)}
          <span className="text-lg text-slate-400 font-semibold">/10</span>
        </div>
        <div className={`mt-1 text-xs font-black tracking-[0.3em] ${color}`}>
          {label} RISK
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VISION
// ---------------------------------------------------------------------------
function VisionPage({
  imageDataUrl,
  report,
  onNext,
  onBack,
}: {
  imageDataUrl: string;
  report: VisionReport;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="relative min-h-screen pt-28 pb-28">
      <div className="relative mx-auto max-w-7xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.4em] text-cyan-300">
              // agent_01 · dermvision
            </div>
            <h2 className="mt-1 text-3xl sm:text-4xl font-black text-slate-50">
              Clinical Lesion Report
            </h2>
          </div>
          <button
            onClick={onBack}
            className="text-xs font-semibold text-slate-400 hover:text-cyan-300"
          >
            ← New Scan
          </button>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Image */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="glass rounded-3xl p-4 sm:p-5"
          >
            <div className="relative overflow-hidden rounded-2xl border border-cyan-400/30 neon-border">
              <img
                src={imageDataUrl}
                alt="Skin scan"
                className="w-full h-[380px] sm:h-[480px] object-cover"
              />
              {/* scanning frame corners */}
              <div className="pointer-events-none absolute inset-0">
                {[
                  "top-2 left-2 border-t-2 border-l-2",
                  "top-2 right-2 border-t-2 border-r-2",
                  "bottom-2 left-2 border-b-2 border-l-2",
                  "bottom-2 right-2 border-b-2 border-r-2",
                ].map((cls, i) => (
                  <div key={i} className={`absolute h-8 w-8 border-cyan-300 ${cls}`} />
                ))}
                <div className="scan-bar" />
                <div className="absolute inset-0 radar-sweep opacity-20 mix-blend-screen" />
              </div>
              <div className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[10px] font-mono text-cyan-300">
                ROI · {(report.confidence * 100).toFixed(0)}% confidence
              </div>
              <div className="absolute right-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[10px] font-mono text-emerald-300">
                ● LIVE ANALYSIS
              </div>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {report.symptoms.slice(0, 4).map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-2 text-center text-[11px] text-slate-300"
                >
                  {s}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Report */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="space-y-5"
          >
            <div className="glass rounded-3xl p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-500">
                    Primary Classification
                  </div>
                  <h3 className="mt-2 text-2xl sm:text-3xl font-black text-cyan-200 neon-text">
                    {report.classification}
                  </h3>
                </div>
                <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-black text-emerald-300 uppercase tracking-wider">
                  Verified
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">
                {report.details}
              </p>
            </div>

            <div className="glass rounded-3xl p-6">
              <div className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-500">
                Risk Factor Rating
              </div>
              <RiskDial value={report.riskScore} />
            </div>

            <button
              onClick={onNext}
              className="btn-shine group flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 py-4 text-base font-black uppercase tracking-[0.2em] text-slate-950 shadow-[0_20px_60px_-20px_rgba(34,211,238,0.6)] hover:brightness-110"
            >
              Analyze Nutrition & Diet
              <span className="group-hover:translate-x-1 transition">→</span>
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NUTRI
// ---------------------------------------------------------------------------
function NutriPage({
  classification,
  report,
  dietText,
  setDietText,
  onAnalyze,
  analyzing,
  onNext,
  onBack,
}: {
  classification: string;
  report: NutriReport | null;
  dietText: string;
  setDietText: (v: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const sample =
    "Breakfast: 2 slices white toast with butter, coffee with milk & sugar. Lunch: Chicken biryani with raita, cola. Snack: chocolate bar + chips. Dinner: paneer butter masala with 2 naan, ice-cream.";

  return (
    <div className="relative min-h-screen pt-28 pb-28">
      <div className="relative mx-auto max-w-5xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.4em] text-violet-300">
              // agent_02 · dermnutri
            </div>
            <h2 className="mt-1 text-3xl sm:text-4xl font-black text-slate-50">
              48-Hour Dietary Audit
            </h2>
            <div className="mt-2 text-sm text-slate-400">
              Targeting:{" "}
              <span className="font-semibold text-cyan-200">{classification}</span>
            </div>
          </div>
          <button
            onClick={onBack}
            className="text-xs font-semibold text-slate-400 hover:text-cyan-300"
          >
            ← Back
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="glass rounded-3xl p-6 sm:p-8"
        >
          <label className="text-sm font-bold text-slate-200">
            Please input the food/diet you have consumed over the last 48 hours.
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Be specific: meals, snacks, beverages, portions. The more detail, the
            sharper the analysis.
          </p>
          <textarea
            value={dietText}
            onChange={(e) => setDietText(e.target.value)}
            rows={7}
            placeholder="e.g. Breakfast: oatmeal with berries, black coffee…"
            className="cli-textarea mt-3 w-full rounded-xl px-4 py-3 text-sm leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setDietText(sample)}
              className="rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-700/60"
            >
               Fill sample diet
            </button>
            <div className="text-[11px] font-mono text-slate-500">
              {dietText.trim().split(/\s+/).filter(Boolean).length} words
            </div>
          </div>

          <button
            onClick={onAnalyze}
            disabled={!dietText.trim() || analyzing}
            className={`btn-shine mt-6 flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-base font-black uppercase tracking-[0.2em] transition ${
              dietText.trim() && !analyzing
                ? "bg-gradient-to-br from-violet-400 to-fuchsia-500 text-slate-950 hover:brightness-110 shadow-[0_20px_60px_-20px_rgba(167,139,250,0.6)]"
                : "bg-slate-800/60 text-slate-500 cursor-not-allowed"
            }`}
          >
            {analyzing ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-slate-950/40 border-t-slate-950 animate-spin" />
                Analyzing diet…
              </>
            ) : (
              <>
                Analyze Diet
                <span>🧬</span>
              </>
            )}
          </button>
        </motion.div>

        <AnimatePresence>
          {report && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="mt-6 grid gap-5 md:grid-cols-2"
            >
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-black uppercase tracking-[0.35em] text-red-300">
                    Triggers Found
                  </div>
                  <div className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-black text-red-300 border border-red-500/30">
                    {report.triggers.length}
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-300">{report.summary}</p>
                <div className="mt-4 space-y-2">
                  {report.triggers.map((t, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-red-400/20 bg-red-500/[0.04] p-3"
                    >
                      <div className="text-sm font-bold text-red-200">
                        ✕ {t.food}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{t.reason}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-black uppercase tracking-[0.35em] text-emerald-300">
                    Recommended Diet
                  </div>
                  <div className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300 border border-emerald-500/30">
                    {report.recommended.length}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {report.recommended.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3"
                    >
                      <div className="text-sm font-bold text-emerald-200">
                        ✓ {r.food}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{r.benefit}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2">
                <button
                  onClick={onNext}
                  className="btn-shine group flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 py-4 text-base font-black uppercase tracking-[0.2em] text-slate-950 shadow-[0_20px_60px_-20px_rgba(52,211,153,0.6)] hover:brightness-110"
                >
                  Proceed to DermCure Treatment
                  <span className="group-hover:translate-x-1 transition">→</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CURE
// ---------------------------------------------------------------------------
type ChatMsg = { role: "user" | "model"; text: string };

function CurePage({
  vision,
  nutri,
  onBack,
}: {
  vision: VisionReport;
  nutri: NutriReport;
  onBack: () => void;
}) {
  const plan = useMemo(() => buildTreatmentPlan(vision.classification), [vision.classification]);
  const reportRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "model",
      text: `Hello. I'm DermCure, your treatment agent. I've reviewed your ${vision.classification} diagnosis and dietary audit. Ask me anything about your AM/PM protocol, medications, or lifestyle.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const userMsg: ChatMsg = { role: "user", text: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    const history: ChatTurn[] = messages.map((m) => ({ role: m.role, text: m.text }));
   const reply = await askGemini(history, userMsg.text);
    setMessages((prev) => [...prev, { role: "model", text: reply }]);
    setSending(false);
  };

  const commit = async () => {
  console.log("1. COMMIT BUTTON CLICKED!"); // Check if this prints!
  try {
    console.log("2. Sending data to Firebase...");
    const rec = await commitReport({
      name: "Current Patient",
      age: 30,
      classification: vision.classification,
      riskScore: vision.riskScore,
    });
    console.log("3. Firebase responded with ID:", rec.id);
    setCommitted(rec.id);
    setTimeout(() => setCommitted(null), 3500);
  } catch (error: any) {
    console.error("4. FIREBASE CRASHED:", error);
    alert(`Database Error: ${error.message}`);
  }
};   
  

  const downloadPdf = async () => {
    if (!reportRef.current || pdfBusy) return;
    setPdfBusy(true);
    try {
      const node = reportRef.current;
      const canvas = await html2canvas(node, {
        backgroundColor: "#0f172a", // CHANGED TO WHITE
        scale: 1.5,
        useCORS: true,
        logging: false,
        windowWidth: 1200,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 40;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 20;
      pdf.addImage(imgData, "PNG", 20, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - 40;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 20;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 20, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - 40;
      }
      pdf.save(`DermLens_Report_${Date.now()}.pdf`);
    } catch (err) {
      console.error("[pdf] failed:", err);
      alert("PDF generation failed. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen pt-28 pb-28">
      <div className="relative mx-auto max-w-7xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 flex flex-wrap items-center justify-between gap-4"
        >
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.4em] text-emerald-300">
              // agent_03 · dermcure
            </div>
            <h2 className="mt-1 text-3xl sm:text-4xl font-black text-slate-50">
              Final Treatment Dashboard
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onBack}
              className="rounded-xl border border-slate-700/60 bg-slate-800/50 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700/60"
            >
              ← Back
            </button>
            <button
              onClick={downloadPdf}
              disabled={pdfBusy}
              className="rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-slate-950 hover:brightness-110 disabled:opacity-60"
            >
              {pdfBusy ? "Generating…" : "⬇ Download Clinical Report"}
            </button>
            <button
              onClick={commit}
              className="rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-slate-950 hover:brightness-110"
            >
              {committed ? `✓ Saved · ${committed}` : "Commit to Database"}
            </button>
          </div>
        </motion.div>

        <div ref={reportRef} className="space-y-6 bg-slate-900 p-8 rounded-3xl">
          {/* Summary strip */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass rounded-2xl p-5">
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-cyan-300">
                DermVision · Summary
              </div>
              <div className="mt-2 text-lg font-black text-slate-100">{vision.classification}</div>
              <div className="mt-1 text-xs text-slate-400">
                Risk score <span className="text-cyan-200 font-bold">{vision.riskScore.toFixed(1)}/10</span> · Confidence {(vision.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="glass rounded-2xl p-5">
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-red-300">
                DermNutri · Triggers
              </div>
              <div className="mt-2 text-sm text-slate-200">
                {nutri.triggers.map((t) => t.food).join(" · ")}
              </div>
            </div>
            <div className="glass rounded-2xl p-5">
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-300">
                DermCure · Status
              </div>
              <div className="mt-2 text-sm text-slate-200">
                Personalized protocol generated. Ready for download & sync.
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Treatment plan */}
            <div className="lg:col-span-2 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <TreatmentColumn title="AM Protocol" accent="cyan" items={plan.am} />
                <TreatmentColumn title="PM Protocol" accent="violet" items={plan.pm} />
              </div>
              <div className="glass rounded-2xl p-5">
                <div className="text-[11px] font-black uppercase tracking-[0.3em] text-amber-300">
                  Oral Medicines & Supplements
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {plan.oral.map((o, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-3"
                    >
                      <div className="text-sm font-bold text-amber-200">{o.name}</div>
                      <div className="text-[11px] font-mono text-amber-300/80 mt-0.5">
                        {o.dose}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{o.purpose}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="glass rounded-2xl p-5">
                  <div className="text-[11px] font-black uppercase tracking-[0.3em] text-sky-300">
                    💧 Hydration
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {plan.hydration.map((h, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-sky-300">›</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="glass rounded-2xl p-5">
                  <div className="text-[11px] font-black uppercase tracking-[0.3em] text-fuchsia-300">
                    🌙 Lifestyle
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {plan.lifestyle.map((h, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-fuchsia-300">›</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Chatbot */}
            <div className="glass rounded-2xl p-0 overflow-hidden flex flex-col min-h-[560px] lg:sticky lg:top-28">
              <div className="flex items-center justify-between border-b border-emerald-400/20 bg-[#05080f] px-4 py-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-300">
                    DermCure · Agent Chat
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">
                    /api/chat · gemini-2.0-flash
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  ONLINE
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "chat-out ml-auto text-slate-100"
                        : "chat-in text-slate-200"
                    }`}
                  >
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] mb-1 opacity-70">
                      {m.role === "user" ? "You" : "DermCure"}
                    </div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))}
                {sending && (
                  <div className="chat-in max-w-[50%] rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-300 animate-bounce" />
                      <span className="h-2 w-2 rounded-full bg-emerald-300 animate-bounce [animation-delay:150ms]" />
                      <span className="h-2 w-2 rounded-full bg-emerald-300 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <form
                onSubmit={send}
                className="border-t border-emerald-400/20 bg-[#05080f] p-3 flex gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your treatment…"
                  className="cli-input flex-1 rounded-xl px-3 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-40"
                >
                  ↵
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreatmentColumn({
  title,
  accent,
  items,
}: {
  title: string;
  accent: "cyan" | "violet";
  items: { step: string; product: string; note: string }[];
}) {
  const grad =
    accent === "cyan"
      ? "from-cyan-400/80 to-sky-400/80"
      : "from-violet-400/80 to-fuchsia-400/80";
  const labelColor = accent === "cyan" ? "text-cyan-300" : "text-violet-300";
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full bg-gradient-to-br ${grad}`} />
        <div className={`text-[11px] font-black uppercase tracking-[0.3em] ${labelColor}`}>
          {title}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {items.map((it, i) => (
          <div key={i} className="relative pl-5">
            <div className="absolute left-0 top-2 h-2 w-2 rounded-full bg-slate-600 ring-2 ring-slate-900" />
            <div className="text-[11px] font-mono text-slate-500">{it.step}</div>
            <div className="text-sm font-semibold text-slate-100">{it.product}</div>
            <div className="text-xs text-slate-400 mt-0.5">{it.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROOT APP
// ---------------------------------------------------------------------------
export default function App() {
  const [appState, setAppState] = useState<AppState>("LANDING");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [visionReport, setVisionReport] = useState<VisionReport | null>(null);
  const [nutriReport, setNutriReport] = useState<NutriReport | null>(null);
  const [dietText, setDietText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  // When processing completes, run the vision agent.
  const handleProcessingDone = async () => {
    if (!imageDataUrl) return;
    const report = await analyzeVision(imageDataUrl);
    setVisionReport(report);
    setAppState("VISION");
  };

  const handleAnalyzeDiet = async () => {
    if (!dietText.trim()) return;
    setAnalyzing(true);
    const r = await analyzeNutrition(dietText, visionReport?.classification ?? "skin condition");
    setNutriReport(r);
    setAnalyzing(false);
  };

  const startOver = () => {
    setAppState("LANDING");
    setImageDataUrl(null);
    setFileName(null);
    setVisionReport(null);
    setNutriReport(null);
    setDietText("");
  };

  return (
    <div className="relative min-h-screen">
      <TopBar state={appState} />

      <AnimatePresence mode="wait">
        {appState === "LANDING" && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <LandingPage
              imageDataUrl={imageDataUrl}
              fileName={fileName}
              onUpload={(url, name) => {
                setImageDataUrl(url);
                setFileName(name);
              }}
              onStart={() => setAppState("PROCESSING")}
            />
          </motion.div>
        )}
        {appState === "PROCESSING" && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <ProcessingPage onDone={handleProcessingDone} />
          </motion.div>
        )}
        {appState === "VISION" && visionReport && imageDataUrl && (
          <motion.div
            key="vision"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <VisionPage
              imageDataUrl={imageDataUrl}
              report={visionReport}
              onNext={() => setAppState("NUTRI")}
              onBack={startOver}
            />
          </motion.div>
        )}
        {appState === "NUTRI" && visionReport && (
          <motion.div
            key="nutri"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <NutriPage
              classification={visionReport.classification}
              report={nutriReport}
              dietText={dietText}
              setDietText={setDietText}
              onAnalyze={handleAnalyzeDiet}
              analyzing={analyzing}
              onNext={() => setAppState("CURE")}
              onBack={() => setAppState("VISION")}
            />
          </motion.div>
        )}
        {appState === "CURE" && visionReport && nutriReport && (
          <motion.div
            key="cure"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <CurePage
              vision={visionReport}
              nutri={nutriReport}
              onBack={() => setAppState("NUTRI")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <DisclaimerBar />
    </div>
  );
}
