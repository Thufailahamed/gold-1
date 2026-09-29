"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { ArrowRightIcon, GemIcon } from "@/components/icons";

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

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "Workflow" },
  { href: "#modules", label: "Modules" },
];

export function HomeNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
      <nav
        aria-label="Primary"
        className={cn(
          "mx-auto flex h-14 max-w-7xl items-center justify-between rounded-full px-3 pl-5 transition-all duration-320 ease-brand",
          scrolled
            ? "bg-void/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_20px_40px_-20px_rgba(0,0,0,0.6)] backdrop-blur-xl"
            : "bg-transparent"
        )}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="GoldOS home">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-b from-gold-light to-gold-deep shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <GemIcon size={15} className="text-void" />
          </span>
          <span className="g-display text-lg tracking-wide text-paper">
            Gold<span className="text-gold">OS</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-4 py-2 text-sm text-paper/60 transition-colors hover:bg-paper/[0.06] hover:text-paper"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden px-3 text-sm text-paper/70 transition-colors hover:text-paper sm:block">
            Sign in
          </Link>
          <Link href="/dashboard" className="home-btn-gold h-10 px-4 text-sm sm:px-5">
            Open console
            <ArrowRightIcon size={14} />
          </Link>
        </div>
      </nav>
    </header>
  );
}
