"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      <input
        aria-label="Scan barcode"
        placeholder="Scan or type barcode (PRD-…) + Enter"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
      <button
        type="submit"
        className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100"
      >
        Look up
      </button>
    </form>
  );
}
