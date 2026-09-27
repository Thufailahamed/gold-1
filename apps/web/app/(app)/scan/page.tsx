"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  Panel,
  CardLink,
  Callout,
  Skeleton,
} from "@/components/ui";
import { ArrowRightIcon, ScanBarcodeIcon } from "@/components/icons";

type Lookup = {
  product: { id: string; barcode: string; name: string; karat: string };
  livePrice: { amount_cents: number } | null;
  noRate: boolean;
};

export default function ScanPage() {
  const [code, setCode] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem("goldos-recent-scans") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const lookup = useQuery({
    queryKey: ["scan", code],
    queryFn: () => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code ?? "")}`),
    enabled: code !== null,
    retry: false,
  });

  function onScan(c: string) {
    setCode(c);
    setRecent((r) => {
      const next = [c, ...r.filter((x) => x !== c)].slice(0, 10);
      window.localStorage.setItem("goldos-recent-scans", JSON.stringify(next));
      return next;
    });
  }

  return (
    <Page>
      <Hero
        kicker="Catalog"
        title="Scan & lookup"
        description="Point a USB or Bluetooth scanner at the barcode, or type the code and press Enter."
      >
        <div className="relative mx-auto mt-8 flex max-w-xl flex-col items-center">
          <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-gold text-ink">
            <ScanBarcodeIcon size={22} />
          </span>
          <ScanInput onScan={onScan} />
        </div>
      </Hero>

      {lookup.isLoading ? <Skeleton className="h-24 rounded-xl" /> : null}
      {lookup.isError ? (
        <Callout tone="danger" title="Not found">
          No product found for <span className="font-mono">{code}</span>.
        </Callout>
      ) : null}
      {lookup.data ? (
        <Panel
          title={lookup.data.product.name}
          description={
            <>
              <span className="font-mono">{lookup.data.product.barcode}</span> ·{" "}
              {lookup.data.product.karat}
            </>
          }
          icon={<ScanBarcodeIcon size={16} />}
          actions={<CardLink href={`/products/${lookup.data.product.id}`}>Open detail</CardLink>}
        >
          {lookup.data.livePrice ? (
            <p className="text-sm text-ink-3">
              Live price:{" "}
              <span className="g-metric text-base text-ink">
                {(lookup.data.livePrice.amount_cents / 100).toLocaleString("en-US")} LKR
              </span>
            </p>
          ) : (
            <p className="text-sm text-ink-4">No live price available for this piece.</p>
          )}
        </Panel>
      ) : null}

      {recent.length > 0 ? (
        <Panel title="Recent scans" description="Last 10 lookups on this device">
          <ul className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <li key={r}>
                <button
                  onClick={() => onScan(r)}
                  className="rounded-full bg-ink/[0.06] px-3 py-1.5 font-mono text-xs text-ink-3 transition-colors hover:bg-ink hover:text-gold"
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </Page>
  );
}

function ScanInput({ onScan }: { onScan: (code: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onScan(v.trim());
          setV("");
        }
      }}
      className="flex w-full flex-col gap-3 sm:flex-row"
    >
      <div className="relative w-full">
        <ScanBarcodeIcon
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold-dark"
        />
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Scan or type barcode…"
          autoComplete="off"
          className="h-12 w-full rounded-lg bg-paper pl-11 pr-4 font-mono text-base text-ink shadow-[inset_0_0_0_1.5px_rgba(201,162,39,0.6)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold,#C9A227),0_0_0_4px_rgba(201,162,39,0.25)]"
        />
      </div>
      <button
        type="submit"
        className="g-btn h-12 bg-gold px-5 text-sm text-ink transition-colors hover:bg-gold-light"
      >
        Look up
        <ArrowRightIcon size={14} className="g-btn-arrow" />
      </button>
    </form>
  );
}
