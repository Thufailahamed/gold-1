"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { lookupPath, normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
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
  product: {
    id: string;
    barcode: string;
    sku: string;
    name: string;
    karat: string;
    status: string;
    net_mg: number;
    selling_price_cents: number | null;
  };
  livePrice: { amount_cents: number } | null;
  noRate: boolean;
};

export default function ScanPage() {
  const router = useRouter();
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

  function onScan(raw: string) {
    const c = normalizeCode(raw);
    if (!c) return;
    // Old-gold items live in the vault and invoice numbers in sales, not
    // the product catalog.
    if (c.startsWith("OG-") || c.startsWith("SINV-")) {
      const path = lookupPath(c);
      if (path) router.push(path);
      return;
    }
    setCode(c);
    setRecent((r) => {
      const next = [c, ...r.filter((x) => x !== c)].slice(0, 10);
      try {
        window.localStorage.setItem("goldos-recent-scans", JSON.stringify(next));
      } catch {
        // Storage can be blocked (private mode); recents are a convenience.
      }
      return next;
    });
  }

  return (
    <Page>
      <Hero
        kicker="Catalog"
        title="Scan & lookup"
        description="Point a USB or Bluetooth scanner at the barcode, use the camera, or type the code and press Enter. Accepts product tags, SKUs, OG- old-gold numbers and SINV- invoice numbers."
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
              <span className="font-mono">{lookup.data.product.sku}</span> · {lookup.data.product.karat} ·{" "}
              {lookup.data.product.status.replace(/_/g, " ").toLowerCase()}
            </>
          }
          icon={<ScanBarcodeIcon size={16} />}
          actions={<CardLink href={`/products/${lookup.data.product.id}`}>Open detail</CardLink>}
        >
          <ScanResult data={lookup.data} />
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

function ScanResult({ data }: { data: Lookup }) {
  const { product, livePrice } = data;
  // The till charges the selling-price override when set, else the live rate.
  const price = product.selling_price_cents ?? livePrice?.amount_cents ?? null;
  const code = encodeURIComponent(product.barcode);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1 text-sm text-ink-3">
        <p>
          {product.selling_price_cents !== null ? "Selling price" : "Live price"}:{" "}
          {price !== null ? (
            <span className="g-metric text-base text-ink">{(price / 100).toLocaleString("en-US")} LKR</span>
          ) : (
            <span className="text-ink-4">no rate for {product.karat}</span>
          )}
        </p>
        <p>Net weight: <span className="num-tabular text-ink">{(product.net_mg / 1000).toLocaleString("en-US")} g</span></p>
      </div>
      <div className="flex flex-wrap gap-2">
        {product.status === "IN_STOCK" ? (
          <Link href={`/pos?add=${code}`} className="g-btn g-btn-primary h-9 px-4 text-sm">
            Sell at POS
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </Link>
        ) : null}
        {product.status === "SOLD" || product.status === "RETURNED" ? (
          <Link href={`/sales/invoices/lookup/${code}`} className="g-btn g-btn-secondary h-9 px-4 text-sm">
            Find sale
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function ScanInput({ onScan }: { onScan: (code: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onScan(v);
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
          placeholder="Scan or type barcode, SKU or invoice no…"
          autoComplete="off"
          className="h-12 w-full rounded-lg bg-paper pl-11 pr-4 font-mono text-base text-ink shadow-[inset_0_0_0_1.5px_rgba(201,162,39,0.6)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold,#C9A227),0_0_0_4px_rgba(201,162,39,0.25)]"
        />
      </div>
      <CameraScanButton onDetected={onScan} className="h-12" />
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
