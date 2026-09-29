import type { CSSProperties } from "react";

const r2 = (n: number) => Math.round(n * 100) / 100;
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: r2(cx + r * Math.cos(a)), y: r2(cy + r * Math.sin(a)) };
};
const pts = (...p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(" ");

function GoldStops({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#FFF4C7" />
      <stop offset="0.35" stopColor="#E7C65A" />
      <stop offset="0.7" stopColor="#C9A227" />
      <stop offset="1" stopColor="#8C6D1F" />
    </linearGradient>
  );
}

function Sparkle({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        className="home-twinkle"
        style={{ transformBox: "fill-box", transformOrigin: "center", animationDelay: `${delay}s` }}
        d="M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10Z"
        fill="#FFF4C7"
      />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Hero emblem: bezel rings, karat dial, faceted gem with sheen         */
/* ------------------------------------------------------------------ */

const C = 260;
const TICKS = Array.from({ length: 120 }, (_, i) => {
  const long = i % 10 === 0;
  const a = polar(C, C, 204, i * 3);
  const b = polar(C, C, long ? 190 : 198, i * 3);
  return { a, b, long };
});
const KARATS = ["24K", "22K", "21K", "18K"].map((k, i) => ({ k, ...polar(C, C, 172, i * 90 + 45) }));
const ORBIT_DOTS = [0, 120, 240].map((d) => polar(C, C, 150, d));

const GEM = {
  A: [225, 205],
  M: [260, 205],
  B: [295, 205],
  D: [186, 238],
  G1: [225, 238],
  G2: [260, 238],
  G3: [295, 238],
  Cc: [334, 238],
  E: [260, 338],
} satisfies Record<string, [number, number]>;
const FACETS: { p: [number, number][]; f: string }[] = [
  { p: [GEM.D, GEM.A, GEM.G1], f: "#E7C65A" },
  { p: [GEM.A, GEM.M, GEM.G1], f: "#FFF4C7" },
  { p: [GEM.M, GEM.G1, GEM.G2], f: "#F1D676" },
  { p: [GEM.M, GEM.G2, GEM.G3], f: "#C9A227" },
  { p: [GEM.M, GEM.B, GEM.G3], f: "#E7C65A" },
  { p: [GEM.B, GEM.G3, GEM.Cc], f: "#A8861B" },
  { p: [GEM.D, GEM.G1, GEM.E], f: "#C9A227" },
  { p: [GEM.G1, GEM.G2, GEM.E], f: "#F1D676" },
  { p: [GEM.G2, GEM.G3, GEM.E], f: "#A8861B" },
  { p: [GEM.G3, GEM.Cc, GEM.E], f: "#8C6D1F" },
];

export function HeroEmblem({ className }: { className?: string }) {
  const origin: CSSProperties = { transformOrigin: `${C}px ${C}px` };
  return (
    <svg viewBox="0 0 520 520" className={className} role="img" aria-label="Animated gold gem inside a karat dial">
      <defs>
        <GoldStops id="he-gold" />
        <radialGradient id="he-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#E7C65A" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#C9A227" stopOpacity="0.08" />
          <stop offset="1" stopColor="#C9A227" stopOpacity="0" />
        </radialGradient>
        <clipPath id="he-gem-clip">
          <polygon points={pts(GEM.D, GEM.A, GEM.B, GEM.Cc, GEM.E)} />
        </clipPath>
        <filter id="he-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <circle cx={C} cy={C} r="250" fill="url(#he-glow)" />

      <g className="home-spin" style={origin}>
        <circle cx={C} cy={C} r="232" fill="none" stroke="rgba(231,198,90,0.25)" strokeDasharray="2 8" />
        <circle cx={C} cy={C - 232} r="4" fill="#E7C65A" />
      </g>

      <g className="home-spin-rev" style={origin}>
        <circle cx={C} cy={C} r="206" fill="none" stroke="rgba(255,255,255,0.08)" />
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.a.x}
            y1={t.a.y}
            x2={t.b.x}
            y2={t.b.y}
            stroke={t.long ? "#E7C65A" : "rgba(255,255,255,0.22)"}
            strokeWidth={t.long ? 1.6 : 1}
          />
        ))}
        {KARATS.map((k) => (
          <text
            key={k.k}
            x={k.x}
            y={k.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(255,244,199,0.75)"
            fontSize="13"
            fontWeight="600"
            letterSpacing="2"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {k.k}
          </text>
        ))}
      </g>

      <circle cx={C} cy={C} r="150" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
      <circle
        cx={C}
        cy={C}
        r="150"
        fill="none"
        stroke="url(#he-gold)"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="home-draw"
        style={{ "--len": 943, transform: "rotate(-90deg)", ...origin } as CSSProperties}
      />

      <g className="home-spin-fast" style={origin}>
        {ORBIT_DOTS.map((d, i) => (
          <g key={i}>
            <circle cx={d.x} cy={d.y} r="9" fill="#E7C65A" opacity="0.35" filter="url(#he-blur)" />
            <circle cx={d.x} cy={d.y} r="3.5" fill="#FFF4C7" />
          </g>
        ))}
      </g>

      <g className="home-float">
        <ellipse cx={C} cy="372" rx="70" ry="8" fill="#000" opacity="0.45" filter="url(#he-blur)" />
        <polygon points={pts(GEM.D, GEM.A, GEM.B, GEM.Cc, GEM.E)} fill="#E7C65A" filter="url(#he-blur)" opacity="0.55" />
        {FACETS.map((f, i) => (
          <polygon
            key={i}
            points={pts(...f.p)}
            fill={f.f}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        ))}
        <g clipPath="url(#he-gem-clip)">
          <rect x="196" y="190" width="38" height="170" fill="#fff" opacity="0.55" className="home-sheen" />
        </g>
      </g>

      <Sparkle x={332} y={196} s={1.1} />
      <Sparkle x={184} y={300} s={0.7} delay={1.1} />
      <Sparkle x={356} y={318} s={0.55} delay={2} />
      <Sparkle x={150} y={150} s={0.5} delay={0.6} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Barcode with sweeping laser                                         */
/* ------------------------------------------------------------------ */

const BARS = [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 1, 3, 2, 1, 1, 2, 3, 1, 2, 2, 1, 4, 1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 3, 2, 1, 1, 2];
const BAR_RECTS = (() => {
  let x = 0;
  return BARS.map((w, i) => {
    const rect = { x, w, on: i % 2 === 0 };
    x += w + 1.2;
    return rect;
  }).filter((b) => b.on);
})();
const BAR_TOTAL = BARS.reduce((s, w) => s + w + 1.2, 0);

export function Barcode({
  className,
  height = 56,
  laser = true,
  ...box
}: {
  className?: string;
  height?: number;
  laser?: boolean;
  x?: number;
  y?: number;
  width?: number | string;
}) {
  return (
    <svg
      viewBox={`-4 -6 ${BAR_TOTAL + 8} ${height + 12}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
      {...box}
      height={box.width !== undefined ? height + 12 : undefined}
    >
      <defs>
        <linearGradient id={`bc-laser-${height}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#E7C65A" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFF4C7" />
          <stop offset="1" stopColor="#E7C65A" stopOpacity="0" />
        </linearGradient>
      </defs>
      {BAR_RECTS.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height={height} fill="currentColor" />
      ))}
      {laser ? (
        <g className="home-scan" style={{ "--scan": `${height}px` } as CSSProperties}>
          <rect x="-4" y="-2" width={BAR_TOTAL + 8} height="4" fill={`url(#bc-laser-${height})`} opacity="0.35" />
          <rect x="-4" y="-0.6" width={BAR_TOTAL + 8} height="1.2" fill={`url(#bc-laser-${height})`} />
        </g>
      ) : null}
    </svg>
  );
}

export function ScanIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 200" className={className} aria-hidden>
      <defs>
        <GoldStops id="sc-gold" />
      </defs>
      <rect x="40" y="30" width="240" height="140" rx="14" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      {[
        "M52 58 V44 H66",
        "M254 44 H268 V58",
        "M268 142 V156 H254",
        "M66 156 H52 V142",
      ].map((d) => (
        <path key={d} d={d} fill="none" stroke="url(#sc-gold)" strokeWidth="3" strokeLinecap="round" />
      ))}
      <Barcode x={76} y={58} width={168} height={64} className="text-paper/85" />
      <text
        x="160"
        y="150"
        textAnchor="middle"
        fill="rgba(255,244,199,0.8)"
        fontSize="11"
        letterSpacing="3"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        JW-M2Q39H
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Live rate chart drawing itself                                      */
/* ------------------------------------------------------------------ */

const RATE_PATH = "M0 118 C 30 112, 44 96, 70 100 S 118 72, 146 80 S 196 58, 222 64 S 270 30, 296 36 S 318 26, 326 22";

export function RateChart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 340 150" className={className} preserveAspectRatio="none" aria-hidden>
      <defs>
        <GoldStops id="rc-gold" />
        <linearGradient id="rc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C9A227" stopOpacity="0.35" />
          <stop offset="1" stopColor="#C9A227" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 60, 90, 120].map((y) => (
        <line key={y} x1="0" x2="340" y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 5" />
      ))}
      <path d={`${RATE_PATH} L 326 150 L 0 150 Z`} fill="url(#rc-area)" />
      <path
        d={RATE_PATH}
        fill="none"
        stroke="url(#rc-gold)"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="home-draw"
        style={{ "--len": 420 } as CSSProperties}
      />
      <circle r="10" fill="#E7C65A" opacity="0.25">
        <animateMotion dur="5s" repeatCount="indefinite" path={RATE_PATH} keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear" />
      </circle>
      <circle r="4" fill="#FFF4C7">
        <animateMotion dur="5s" repeatCount="indefinite" path={RATE_PATH} keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear" />
      </circle>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Dual ledger balance scale                                           */
/* ------------------------------------------------------------------ */

function Pan({ x, label, cls }: { x: number; label: string; cls: string }) {
  return (
    <g className={cls}>
      <line x1={x} y1="62" x2={x - 30} y2="128" stroke="rgba(255,255,255,0.3)" />
      <line x1={x} y1="62" x2={x + 30} y2="128" stroke="rgba(255,255,255,0.3)" />
      <path d={`M${x - 38} 128 H${x + 38} Q${x + 30} 150 ${x} 150 Q${x - 30} 150 ${x - 38} 128Z`} fill="url(#lb-gold)" />
      <text
        x={x}
        y="120"
        textAnchor="middle"
        fill="#FFF4C7"
        fontSize="12"
        fontWeight="600"
        letterSpacing="1.5"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </text>
    </g>
  );
}

export function LedgerScale({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 200" className={className} aria-hidden>
      <defs>
        <GoldStops id="lb-gold" />
      </defs>
      <rect x="158" y="58" width="4" height="118" rx="2" fill="url(#lb-gold)" />
      <path d="M118 184 H202 Q196 170 160 170 Q124 170 118 184Z" fill="url(#lb-gold)" />
      <g className="home-tilt" style={{ transformOrigin: "160px 60px" }}>
        <rect x="68" y="57" width="184" height="6" rx="3" fill="url(#lb-gold)" />
        <circle cx="68" cy="60" r="5" fill="#E7C65A" />
        <circle cx="252" cy="60" r="5" fill="#E7C65A" />
      </g>
      <Pan x={68} label="GRAMS" cls="home-pan-l" />
      <Pan x={252} label="LKR" cls="home-pan-r" />
      <circle cx="160" cy="58" r="9" fill="#120f0d" stroke="url(#lb-gold)" strokeWidth="3" />
      <circle cx="160" cy="58" r="2.5" fill="#FFF4C7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Old gold lifecycle: intake → testing → melting → stock              */
/* ------------------------------------------------------------------ */

const FLOW_PATH = "M30 110 C 80 30, 120 30, 125 90 S 180 170, 200 100 S 260 20, 300 80";
const FLOW_NODES = [
  { x: 30, y: 110, label: "Intake" },
  { x: 125, y: 90, label: "Test" },
  { x: 200, y: 100, label: "Melt" },
  { x: 300, y: 80, label: "Stock" },
];

export function LifecycleFlow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 330 170" className={className} aria-hidden>
      <defs>
        <GoldStops id="lf-gold" />
        <filter id="lf-blur" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <path d={FLOW_PATH} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round" />
      <path d={FLOW_PATH} fill="none" stroke="url(#lf-gold)" strokeWidth="2" strokeLinecap="round" className="home-flow" />
      {[0, 1.2, 2.4].map((begin) => (
        <g key={begin}>
          <circle r="8" fill="#E7C65A" filter="url(#lf-blur)">
            <animateMotion dur="3.6s" begin={`${begin}s`} repeatCount="indefinite" path={FLOW_PATH} />
          </circle>
          <circle r="3.5" fill="#FFF4C7">
            <animateMotion dur="3.6s" begin={`${begin}s`} repeatCount="indefinite" path={FLOW_PATH} />
          </circle>
        </g>
      ))}
      {FLOW_NODES.map((n, i) => (
        <g key={n.label}>
          <circle
            cx={n.x}
            cy={n.y}
            r="14"
            fill="none"
            stroke="#E7C65A"
            className="home-pulse-ring"
            style={{ animationDelay: `${i * 0.6}s` }}
          />
          <circle cx={n.x} cy={n.y} r="9" fill="#120f0d" stroke="url(#lf-gold)" strokeWidth="2.5" />
          <text
            x={n.x}
            y={n.y + (i % 2 === 0 ? 30 : -22)}
            textAnchor="middle"
            fill="rgba(255,244,199,0.75)"
            fontSize="10"
            letterSpacing="2"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {n.label.toUpperCase()}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Shield with audit log                                               */
/* ------------------------------------------------------------------ */

const LOG = ["sale.create", "rate.publish", "melt.close", "user.role"];

export function AuditShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 200" className={className} aria-hidden>
      <defs>
        <GoldStops id="as-gold" />
      </defs>
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx="90"
          cy="100"
          r="60"
          fill="none"
          stroke="#E7C65A"
          strokeWidth="1"
          className="home-pulse-ring"
          style={{ animationDelay: `${i}s` }}
        />
      ))}
      <path
        d="M90 44 L132 60 V98 C132 128 112 148 90 158 C68 148 48 128 48 98 V60 Z"
        fill="rgba(201,162,39,0.12)"
        stroke="url(#as-gold)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M72 100 L86 114 L110 88"
        fill="none"
        stroke="#FFF4C7"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="home-draw"
        style={{ "--len": 60 } as CSSProperties}
      />
      {LOG.map((l, i) => (
        <g key={l} className="home-log-row" style={{ animationDelay: `${i * 0.5}s` }}>
          <rect x="164" y={46 + i * 28} width="136" height="20" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
          <circle cx="175" cy={56 + i * 28} r="3" fill="#34d399" />
          <text
            x="185"
            y={60 + i * 28}
            fill="rgba(255,255,255,0.7)"
            fontSize="10"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {l}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Branch network with travelling pulses                              */
/* ------------------------------------------------------------------ */

const HUB = { x: 160, y: 100 };
const BRANCHES = [
  { x: 48, y: 52 },
  { x: 60, y: 160 },
  { x: 272, y: 46 },
  { x: 282, y: 150 },
  { x: 160, y: 20 },
];

export function BranchNetwork({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 190" className={className} aria-hidden>
      <defs>
        <GoldStops id="bn-gold" />
        <filter id="bn-blur" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {BRANCHES.map((b, i) => {
        const d = `M${b.x} ${b.y} L${HUB.x} ${HUB.y}`;
        return (
          <g key={i}>
            <path d={d} stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
            <circle r="5" fill="#E7C65A" filter="url(#bn-blur)">
              <animateMotion dur="2.4s" begin={`${i * 0.45}s`} repeatCount="indefinite" path={d} />
            </circle>
            <circle r="2.2" fill="#FFF4C7">
              <animateMotion dur="2.4s" begin={`${i * 0.45}s`} repeatCount="indefinite" path={d} />
            </circle>
            <circle cx={b.x} cy={b.y} r="8" fill="#120f0d" stroke="rgba(231,198,90,0.7)" strokeWidth="1.5" />
            <circle cx={b.x} cy={b.y} r="2.5" fill="#E7C65A" />
          </g>
        );
      })}
      <circle cx={HUB.x} cy={HUB.y} r="26" fill="none" stroke="#E7C65A" className="home-pulse-ring" />
      <circle cx={HUB.x} cy={HUB.y} r="22" fill="url(#bn-gold)" />
      <path
        d={`M${HUB.x - 8} ${HUB.y - 4} L${HUB.x - 4} ${HUB.y - 9} H${HUB.x + 4} L${HUB.x + 8} ${HUB.y - 4} L${HUB.x} ${HUB.y + 8} Z`}
        fill="#120f0d"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Oversized footer wordmark with travelling sheen                     */
/* ------------------------------------------------------------------ */

export function FooterWordmark({ className }: { className?: string }) {
  const text = {
    x: 600,
    y: 262,
    textAnchor: "middle" as const,
    fontSize: 300,
    fontWeight: 800,
    textLength: 1160,
    lengthAdjust: "spacingAndGlyphs" as const,
    style: { fontFamily: "var(--font-display)", letterSpacing: "-0.04em" },
  };
  return (
    <svg viewBox="0 0 1200 250" className={className} aria-hidden>
      <defs>
        <linearGradient id="fw-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E7C65A" stopOpacity="0.22" />
          <stop offset="0.75" stopColor="#C9A227" stopOpacity="0.04" />
          <stop offset="1" stopColor="#C9A227" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fw-sheen" gradientUnits="userSpaceOnUse" x1="-400" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#FFF4C7" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFF4C7" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFF4C7" stopOpacity="0" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="0 0; 1600 0; 1600 0"
            keyTimes="0; 0.6; 1"
            dur="7s"
            repeatCount="indefinite"
          />
        </linearGradient>
        <linearGradient id="fw-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="fw-mask">
          <rect width="1200" height="250" fill="url(#fw-fade)" />
        </mask>
      </defs>
      <g mask="url(#fw-mask)">
        <text {...text} fill="url(#fw-fill)" stroke="rgba(231,198,90,0.28)" strokeWidth="1.2">
          GoldOS
        </text>
        <text {...text} fill="none" stroke="url(#fw-sheen)" strokeWidth="2">
          GoldOS
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked ingots for the closing CTA                                  */
/* ------------------------------------------------------------------ */

function Ingot({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <polygon points="14,0 106,0 120,34 0,34" fill="url(#ig-top)" />
      <polygon points="0,34 120,34 120,44 0,44" fill="#8C6D1F" />
      <polygon points="14,0 106,0 120,34 0,34" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
      <text
        x="60"
        y="22"
        textAnchor="middle"
        fill="rgba(92,70,16,0.75)"
        fontSize="9"
        fontWeight="700"
        letterSpacing="2"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        999.9
      </text>
      <g clipPath="url(#ig-clip)">
        <rect
          x="-26"
          y="-4"
          width="22"
          height="52"
          fill="#fff"
          opacity="0.5"
          className="home-sheen"
          style={{ animationDelay: `${delay}s`, "--sheen-to": "760%" } as CSSProperties}
        />
      </g>
    </g>
  );
}

export function IngotStack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 200" className={className} aria-hidden>
      <defs>
        <linearGradient id="ig-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF4C7" />
          <stop offset="0.5" stopColor="#E7C65A" />
          <stop offset="1" stopColor="#C9A227" />
        </linearGradient>
        <clipPath id="ig-clip">
          <polygon points="14,0 106,0 120,34 0,34" />
        </clipPath>
        <filter id="ig-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      <ellipse cx="150" cy="182" rx="120" ry="10" fill="#000" opacity="0.5" filter="url(#ig-blur)" />
      <Ingot x={24} y={128} delay={0} />
      <Ingot x={156} y={128} delay={0.4} />
      <Ingot x={90} y={84} delay={0.8} />
      <g className="home-float">
        <Ingot x={90} y={24} delay={1.2} />
      </g>
      <Sparkle x={228} y={60} s={0.9} delay={0.3} />
      <Sparkle x={64} y={82} s={0.6} delay={1.4} />
    </svg>
  );
}
