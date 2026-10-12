"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ------------------------------------------------------------------ */
/* Gold dust: drifting, twinkling particles that part around the cursor */
/* ------------------------------------------------------------------ */

interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  tw: number;
  ph: number;
}

export function GoldDust({ className, density = 0.00008 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx || reducedMotion()) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const mouse = { x: -9999, y: -9999 };
    let w = 0;
    let h = 0;
    let motes: Mote[] = [];
    let raf = 0;
    let visible = false;

    const spawn = (anywhere: boolean): Mote => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 8,
      r: Math.random() * 1.5 + 0.4,
      vx: (Math.random() - 0.5) * 0.14,
      vy: -(Math.random() * 0.22 + 0.05),
      a: Math.random() * 0.55 + 0.25,
      tw: Math.random() * 0.025 + 0.006,
      ph: Math.random() * Math.PI * 2,
    });

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      motes = Array.from({ length: Math.max(18, Math.round(w * h * density)) }, () => spawn(true));
    };

    const tick = () => {
      raf = 0;
      if (!visible) return;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        const dx = m.x - mouse.x;
        const dy = m.y - mouse.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 130) {
          const f = (1 - d / 130) * 1.4;
          m.x += (dx / (d || 1)) * f;
          m.y += (dy / (d || 1)) * f;
        }
        m.x += m.vx;
        m.y += m.vy;
        m.ph += m.tw;
        if (m.y < -8 || m.x < -8 || m.x > w + 8) Object.assign(m, spawn(false));
        const alpha = m.a * (0.5 + 0.5 * Math.sin(m.ph));
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4);
        g.addColorStop(0, `rgba(255, 236, 170, ${alpha})`);
        g.addColorStop(0.35, `rgba(226, 194, 122, ${alpha * 0.55})`);
        g.addColorStop(1, "rgba(205, 168, 83, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: globalThis.PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [density]);

  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}

/* ------------------------------------------------------------------ */
/* Spotlight card: a soft light and rim highlight follow the cursor     */
/* ------------------------------------------------------------------ */

export function SpotCard({ children, className }: { children: ReactNode; className?: string }) {
  function onMove(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div onPointerMove={onMove} className={cn("hx-spot", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ribbon: oversized type that slides with scroll and skews with speed  */
/* ------------------------------------------------------------------ */

export function ScrollRibbon({ rows }: { rows: string[][] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const lines = Array.from(el.querySelectorAll<HTMLElement>("[data-row]"));
    let lastY = window.scrollY;
    let skew = 0;
    let raf = 0;
    let visible = false;

    const tick = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const travel = window.innerHeight - r.top;
      const v = window.scrollY - lastY;
      lastY = window.scrollY;
      skew += (Math.max(-12, Math.min(12, v * 0.35)) - skew) * 0.12;
      lines.forEach((line, i) => {
        const dir = i % 2 === 0 ? -1 : 1;
        const base = dir === -1 ? 0 : -line.scrollWidth / 3;
        line.style.transform = `translate3d(${base + dir * travel * 0.45}px, 0, 0) skewX(${-skew}deg)`;
      });
      if (visible && Math.abs(skew) > 0.01) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) kick();
    });
    io.observe(el);
    window.addEventListener("scroll", kick, { passive: true });
    kick();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", kick);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="space-y-2 overflow-hidden py-4 sm:space-y-4">
      {rows.map((words, i) => (
        <div key={i} data-row className="flex w-max will-change-transform">
          {[0, 1, 2].map((rep) => (
            <span key={rep} className="flex shrink-0 items-center">
              {words.map((w) => (
                <span
                  key={w}
                  className={cn(
                    "hx-display flex items-center whitespace-nowrap px-4 text-[3.25rem] leading-[1.1] sm:px-6 sm:text-[6.5rem]",
                    i % 2 === 0 ? "text-[#10201b]" : "hx-ribbon-outline"
                  )}
                >
                  {w}
                  <span className="ml-8 inline-block size-3 rotate-45 rounded-[3px] bg-gradient-to-br from-gold-light to-gold-deep sm:ml-12 sm:size-4" />
                </span>
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
