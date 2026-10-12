"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Reports how far an element has scrolled through its own sticky range (0 → 1). */
function useStickyProgress(ref: RefObject<HTMLElement | null>, onProgress: (p: number) => void) {
  const cb = useRef(onProgress);
  cb.current = onProgress;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      cb.current(1);
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const range = r.height - window.innerHeight;
      cb.current(range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 1);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);
}

/** Eases a displayed number toward `target` whenever it changes. */
function useTween(target: number, ms = 450) {
  const [v, setV] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (reducedMotion()) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const next = a + (target - a) * (1 - Math.pow(1 - p, 3));
      from.current = next;
      setV(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return v;
}

/* ------------------------------------------------------------------ */
/* Hero stage: 3D tilt with a cursor-following light                    */
/* ------------------------------------------------------------------ */

export function TiltStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - y) * 5}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 7}deg`);
    el.style.setProperty("--sx", `${x * 100}%`);
    el.style.setProperty("--sy", `${y * 100}%`);
    el.style.setProperty("--tx", (x - 0.5).toFixed(3));
    el.style.setProperty("--ty", (y - 0.5).toFixed(3));
    el.dataset.active = "true";
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--tx", "0");
    el.style.setProperty("--ty", "0");
    el.dataset.active = "false";
  }

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn("hx-tilt", className)}>
      {children}
      <div className="hx-tilt-light pointer-events-none absolute inset-0" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Magnetic wrapper for primary buttons                                */
/* ------------------------------------------------------------------ */

export function Magnetic({ children, strength = 0.25 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  function onMove(e: PointerEvent<HTMLSpanElement>) {
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    e.currentTarget.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
  }

  function onLeave() {
    if (ref.current) ref.current.style.transform = "";
  }

  return (
    <span
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="inline-flex transition-transform duration-320 ease-brand"
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stat that counts up once it scrolls into view                       */
/* ------------------------------------------------------------------ */

export function CountStat({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const v = useCountUp(seen ? value : undefined, 1400);
  return (
    <span ref={ref} className="tabular-nums">
      {Math.round(v)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Manifesto: words light up as the section scrolls                    */
/* ------------------------------------------------------------------ */

/** Words wrapped in *asterisks* render in gold. */
export function WordReveal({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null);
  const words = text.split(" ");

  useStickyProgress(ref, (p) => ref.current?.style.setProperty("--p", p.toFixed(4)));

  return (
    <section ref={ref} aria-label="Manifesto" className="relative h-[240vh] bg-white" style={{ "--n": words.length } as CSSProperties}>
      <div className="sticky top-0 flex h-dvh items-center">
        <p className="hx-display mx-auto max-w-5xl px-6 text-center text-[2.1rem] leading-[1.12] text-[#10201b] sm:text-5xl lg:text-[4.25rem]">
          {words.map((raw, i) => {
            const gold = raw.startsWith("*");
            const w = raw.replace(/\*/g, "");
            return (
              <span key={i} className="hx-word" style={{ "--i": i } as CSSProperties}>
                <span className={gold ? "hx-gold-text" : undefined}>{w}</span>{" "}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Karat studio: price a piece with the counter's formula              */
/* ------------------------------------------------------------------ */

const BASE_24K = 36500;
const KARATS = [
  { k: "24K", purity: 0.999, fineness: "999", hi: "#FFE38A", mid: "#F2C230", lo: "#9A6F05" },
  { k: "22K", purity: 0.916, fineness: "916", hi: "#FBE29A", mid: "#E2B53E", lo: "#7E6223" },
  { k: "21K", purity: 0.875, fineness: "875", hi: "#F6E0A8", mid: "#D6AE52", lo: "#846A2C" },
  { k: "18K", purity: 0.75, fineness: "750", hi: "#F1DFB8", mid: "#C9A76A", lo: "#7A6440" },
].map((x) => ({ ...x, rate: Math.round((BASE_24K * x.purity) / 10) * 10 }));

const lkr = (n: number) => `LKR ${Math.round(n).toLocaleString("en-US")}`;

function Ingot({ karat }: { karat: (typeof KARATS)[number] }) {
  const t = { transition: "stop-color 700ms cubic-bezier(0.22, 1, 0.36, 1)" };
  return (
    <svg viewBox="0 0 420 260" className="h-auto w-full" role="img" aria-label={`${karat.k} gold ingot`}>
      <defs>
        <linearGradient id="ks-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ ...t, stopColor: karat.hi }} />
          <stop offset="1" style={{ ...t, stopColor: karat.mid }} />
        </linearGradient>
        <linearGradient id="ks-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ ...t, stopColor: karat.mid }} />
          <stop offset="1" style={{ ...t, stopColor: karat.lo }} />
        </linearGradient>
        <linearGradient id="ks-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ ...t, stopColor: karat.lo }} />
          <stop offset="1" style={{ ...t, stopColor: karat.mid }} />
        </linearGradient>
        <linearGradient id="ks-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ks-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.7" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id="ks-clip">
          <polygon points="110,70 310,70 350,120 70,120" />
          <polygon points="70,120 350,120 370,200 50,200" />
        </clipPath>
      </defs>

      <ellipse cx="210" cy="222" rx="190" ry="22" fill="url(#ks-shadow)" />
      <polygon points="350,120 310,70 330,150 370,200" fill="url(#ks-side)" opacity="0.6" />
      <polygon points="110,70 310,70 350,120 70,120" fill="url(#ks-top)" />
      <polygon points="70,120 350,120 370,200 50,200" fill="url(#ks-front)" />
      <line x1="70" y1="120" x2="350" y2="120" stroke="#fff" strokeOpacity="0.55" />

      <g clipPath="url(#ks-clip)">
        <rect x="-160" y="40" width="120" height="200" fill="url(#ks-sheen)" className="hx-ingot-sheen" />
      </g>

      <text
        x="210"
        y="155"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        letterSpacing="4"
        fill="#000"
        fillOpacity="0.32"
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        GOLDOS
      </text>
      <text
        x="210"
        y="182"
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        letterSpacing="3"
        fill="#000"
        fillOpacity="0.4"
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        {karat.k} · {karat.fineness}
      </text>
    </svg>
  );
}

function Range({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-sm text-[#93a29c]">{label}</span>
        <span className="g-metric text-lg text-white">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="hx-range mt-2"
        style={{ "--fill": fill } as CSSProperties}
      />
    </label>
  );
}

export function KaratStudio() {
  const [ki, setKi] = useState(1);
  const [weight, setWeight] = useState(8.42);
  const [making, setMaking] = useState(12000);
  const karat = KARATS[ki] ?? KARATS[1]!;

  const fine = weight * karat.purity;
  const metal = weight * karat.rate;
  const total = metal + making;

  const tFine = useTween(fine);
  const tMetal = useTween(metal);
  const tTotal = useTween(total);
  const tRate = useTween(karat.rate);

  const ingotRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const firstRender = useRef(true);

  // A little weight to each karat change: the ingot drops and settles, the total glints.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (reducedMotion()) return;
    ingotRef.current?.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-18px) scale(1.04)", offset: 0.35 },
        { transform: "translateY(4px) scale(0.985)", offset: 0.7 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
    totalRef.current?.animate(
      [
        { textShadow: "0 0 0 rgba(205,168,83,0)" },
        { textShadow: "0 0 24px rgba(205,168,83,0.55)" },
        { textShadow: "0 0 0 rgba(205,168,83,0)" },
      ],
      { duration: 900, easing: "ease-out" }
    );
  }, [ki]);

  return (
    <div className="grid items-stretch gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="hx-glow-border relative flex flex-col overflow-hidden rounded-[32px] bg-white/[0.035] p-6 ring-1 ring-white/[0.08] sm:p-10">
        <div
          className="pointer-events-none absolute left-1/2 top-[42%] size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[90px] transition-colors duration-700"
          style={{ background: karat.mid, opacity: 0.22 }}
        />
        <div className="relative flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-light">Purity</span>
          <span className="g-metric text-sm text-white/50">Fineness {karat.fineness}</span>
        </div>
        <div className="hx-display relative mt-2 text-6xl text-white sm:text-7xl">
          {(karat.purity * 100).toFixed(1)}
          <span className="text-3xl text-white/40 sm:text-4xl">%</span>
        </div>

        <div className="relative mx-auto mt-4 w-full max-w-md flex-1 content-center">
          <div className="hx-float-slow">
            <div ref={ingotRef}>
              <Ingot karat={karat} />
            </div>
          </div>
        </div>

        <div role="radiogroup" aria-label="Karat" className="relative mt-6 grid grid-cols-4 gap-1 rounded-full bg-white/[0.06] p-1">
          {KARATS.map((k, i) => (
            <button
              key={k.k}
              type="button"
              role="radio"
              aria-checked={i === ki}
              onClick={() => setKi(i)}
              className={cn(
                "rounded-full py-2.5 text-sm font-semibold transition-all duration-320 ease-brand",
                i === ki ? "bg-white text-black shadow-[0_6px_20px_-8px_rgba(255,255,255,0.6)]" : "text-white/60 hover:text-white"
              )}
            >
              {k.k}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="space-y-6 rounded-[32px] bg-white/[0.035] p-6 ring-1 ring-white/[0.08] sm:p-8">
          <Range
            label="Net weight"
            value={weight}
            display={`${weight.toFixed(2)} g`}
            min={1}
            max={60}
            step={0.01}
            onChange={setWeight}
          />
          <Range
            label="Making charge"
            value={making}
            display={lkr(making)}
            min={0}
            max={60000}
            step={500}
            onChange={setMaking}
          />
        </div>

        <div className="hx-receipt relative flex-1 rounded-[28px] bg-[#fbfaf7] p-6 text-[#10201b] sm:p-8">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-deep">Price breakdown</span>
            <span className="g-metric text-[11px] text-[#7a8a84]">{karat.k} board</span>
          </div>
          <dl className="mt-5 space-y-2.5 text-sm">
            {[
              ["Fine gold", `${tFine.toFixed(3)} g`],
              ["Board rate", `${lkr(tRate)} / g`],
              ["Metal value", lkr(tMetal)],
              ["Making", lkr(making)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt className="text-[#5d6e68]">{k}</dt>
                <dd className="g-metric text-[#10201b]">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="my-5 border-t border-dashed border-black/15" />
          <div className="flex items-end justify-between gap-4">
            <span className="text-sm font-semibold">Total</span>
            <span ref={totalRef} className="hx-display text-3xl tabular-nums sm:text-4xl">
              {lkr(tTotal)}
            </span>
          </div>
          <p className="g-metric mt-4 text-[11px] text-[#7a8a84]">
            net weight × board rate + making · sample rates for illustration
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Journey: pinned horizontal scroll through the five moves            */
/* ------------------------------------------------------------------ */

export interface JourneyStep {
  title: string;
  desc: string;
  icon: ReactNode;
  record: [string, string][];
}

function JourneyPanel({ step, index, active }: { step: JourneyStep; index: number; active: boolean }) {
  return (
    <article
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-[32px] bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_30px_60px_-34px_rgba(0,0,0,0.3)] transition-all duration-500 ease-brand sm:p-9",
        active ? "opacity-100" : "lg:scale-[0.96] lg:opacity-50"
      )}
    >
      <span className="hx-outline-num hx-display pointer-events-none absolute -right-3 -top-6 text-[9rem] leading-none sm:text-[11rem]">
        0{index + 1}
      </span>
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-[#10201b] text-gold-light shadow-[0_14px_28px_-12px_rgba(126,98,35,0.7)]">
        {active ? <span aria-hidden className="hx-ring absolute inset-0 rounded-2xl" /> : null}
        {step.icon}
      </span>
      <h3 className="hx-display relative mt-7 text-4xl text-[#10201b]">{step.title}</h3>
      <p className="relative mt-3 max-w-sm text-[15px] leading-relaxed text-[#5d6e68]">{step.desc}</p>
      <dl className="relative mt-auto space-y-2 rounded-2xl bg-[#f6f5f0] p-4 pt-8 text-[13px] sm:pt-4">
        {step.record.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-[#7a8a84]">{k}</dt>
            <dd className="g-metric text-[#10201b]">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function JourneyScroll({ steps, header }: { steps: JourneyStep[]; header: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useStickyProgress(ref, (p) => {
    const track = trackRef.current;
    if (!track) return;
    const dist = Math.max(0, track.scrollWidth - window.innerWidth);
    track.style.transform = `translate3d(${-p * dist}px, 0, 0)`;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    setActive(Math.min(steps.length - 1, Math.round(p * (steps.length - 1))));
  });

  return (
    <div id="workflow">
      <section
        ref={ref}
        className="relative hidden bg-[#f6f5f0] lg:block"
        style={{ height: `${steps.length * 75 + 40}vh` }}
      >
        <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden">
          <div className="mx-auto w-full max-w-6xl px-6">{header}</div>
          <div
            ref={trackRef}
            className="mt-12 flex w-max gap-6 will-change-transform"
            style={{ paddingInline: "max(1.5rem, calc((100vw - 72rem) / 2 + 1.5rem))" }}
          >
            {steps.map((s, i) => (
              <div key={s.title} className="h-[min(58vh,480px)] w-[440px] shrink-0">
                <JourneyPanel step={s} index={i} active={i === active} />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-10 w-full max-w-6xl px-6">
            <div className="relative h-px bg-black/10">
              <div ref={fillRef} className="absolute inset-0 origin-left scale-x-0 bg-gradient-to-r from-gold-dark to-gold-light" />
            </div>
            <ol className="mt-4 flex justify-between text-xs">
              {steps.map((s, i) => (
                <li
                  key={s.title}
                  className={cn("transition-colors duration-320", i <= active ? "text-[#10201b]" : "text-[#7a8a84]")}
                >
                  <span className="g-metric mr-1.5 text-gold-dark">0{i + 1}</span>
                  {s.title}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="bg-[#f6f5f0] py-24 lg:hidden">
        <div className="px-5">{header}</div>
        <ol className="mt-12 space-y-4 px-4">
          {steps.map((s, i) => (
            <li key={s.title} className="h-[26rem]">
              <JourneyPanel step={s} index={i} active />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
