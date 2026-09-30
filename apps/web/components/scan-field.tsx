"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { lookupPath } from "@/lib/barcode";
import { CameraScanButton } from "./camera-scan";
import { ScanBarcodeIcon } from "./icons";

/**
 * Barcode lookup field. `compact` renders the header variant: slimmer,
 * no submit button (Enter submits), and "/" focuses it globally.
 */
export function ScanField({ compact = false }: { compact?: boolean }) {
  const [code, setCode] = useState("");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!compact) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [compact]);

  function go(raw: string) {
    const path = lookupPath(raw);
    if (!path) return;
    setCode("");
    inputRef.current?.blur();
    router.push(path);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    go(code);
  }

  if (compact) {
    return (
      <form onSubmit={submit} className="relative w-full max-w-md">
        <ScanBarcodeIcon
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
        />
        <input
          ref={inputRef}
          aria-label="Scan or type a barcode"
          placeholder="Scan barcode or press /"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          className="h-9 w-full rounded-lg bg-paper pl-9 pr-10 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(28,25,23,0.12)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)]"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-ink/15 bg-bone px-1.5 font-mono text-[10px] leading-4 text-ink-4">
          /
        </kbd>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <div className={cn("relative w-full max-w-sm")}>
        <ScanBarcodeIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
        <input
          aria-label="Scan barcode"
          placeholder="Scan or type barcode (JW-…, SKU-…, OG-…) + Enter"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          className="h-10 w-full rounded-lg bg-paper pl-9 pr-3 font-mono text-sm text-ink shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)]"
        />
      </div>
      <CameraScanButton onDetected={go} className="h-10" />
      <button type="submit" className="g-btn g-btn-secondary h-10 px-4 text-sm">
        Look up
      </button>
    </form>
  );
}
