"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBarcodeIcon } from "./icons";

export function ScanField() {
  const [code, setCode] = useState("");
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(`/products/barcode/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <div className="relative w-full max-w-sm">
        <ScanBarcodeIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
        <input
          aria-label="Scan barcode"
          placeholder="Scan or type barcode (PRD-…) + Enter"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          className="h-10 w-full rounded-lg bg-paper pl-9 pr-3 font-mono text-sm text-ink shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)]"
        />
      </div>
      <button type="submit" className="g-btn g-btn-secondary h-10 px-4 text-sm">
        Look up
      </button>
    </form>
  );
}
