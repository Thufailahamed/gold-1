"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { GemIcon } from "@/components/icons";

export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry && (entry.isIntersecting || entry.boundingClientRect.top < 0)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-visible={visible}
      className={cn("home-reveal", className)}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

export function SpotlightCard({
  children,
  className,
  tone = "dark",
}: {
  children: ReactNode;
  className?: string;
  tone?: "dark" | "light";
}) {
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div
      onPointerMove={onPointerMove}
      className={cn("home-card h-full", tone === "dark" ? "home-card-dark" : "home-card-light", className)}
    >
      {children}
    </div>
  );
}

/** Grows its child from 90% to full size as it scrolls into view. */
export function ScrollScale({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - el.getBoundingClientRect().top) / (vh * 0.85)));
      el.style.setProperty("--p", p.toFixed(3));
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
  }, []);

  return (
    <div ref={ref} className={cn("hx-scroll-scale", className)}>
      {children}
    </div>
  );
}

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "Workflow" },
  { href: "#modules", label: "Modules" },
];

export function HomeNav() {
  const [scrolled, setScrolled] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (barRef.current) barRef.current.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "hx-nav-in fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow] duration-320 ease-brand",
        scrolled && "hx-nav"
      )}
    >
      <nav aria-label="Primary" className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="GoldOS home">
          <span className="flex size-7 items-center justify-center rounded-[9px] bg-gradient-to-b from-gold-light to-gold-deep shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <GemIcon size={13} className="text-white" />
          </span>
          <span className="hx-display text-[17px] tracking-[-0.02em] text-[#10201b]">GoldOS</span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13px] text-[#10201b]/70 transition-colors duration-200 hover:text-[#10201b]"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="hidden text-[13px] text-[#10201b]/70 transition-colors hover:text-[#10201b] sm:block"
          >
            Sign in
          </Link>
          <Link href="/dashboard" className="hx-btn hx-btn-dark h-8 px-4 text-[13px]">
            Open console
          </Link>
        </div>
      </nav>
      <div
        ref={barRef}
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-gradient-to-r from-gold-dark via-gold-light to-gold transition-opacity duration-320",
          scrolled ? "opacity-100" : "opacity-0"
        )}
      />
    </header>
  );
}
