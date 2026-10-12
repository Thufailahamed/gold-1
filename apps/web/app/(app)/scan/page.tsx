"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { lookupPath, normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import { Card, CardHead, GoldHero, HeroBadge } from "@/components/console-kit";
import { AlertCircleIcon, ArrowRightIcon, BanknoteIcon, GemIcon, HistoryIcon, ScaleIcon, ScanBarcodeIcon, XIcon } from "@/components/icons";

const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const STATUS_CHIP: Record<string, string> = {
  IN_STOCK: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25",
  RESERVED: "bg-amber-500/10 text-amber-800 ring-amber-500/25",
  SOLD: "bg-sky-500/10 text-sky-800 ring-sky-500/25",
  IN_REPAIR: "bg-rose-500/10 text-rose-800 ring-rose-500/25",
};
/** What the field accepts, and where each kind of code goes. */
const FORMATS = [
  { k: "Product tag", ex: "barcode on the label", to: "Piece detail", tone: "#B8923F" },
  { k: "SKU", ex: "catalogue code", to: "Piece detail", tone: "#7C3AED" },
  { k: "OG-…", ex: "old-gold item", to: "Old Gold", tone: "#D97706" },
  { k: "SINV-…", ex: "sales invoice", to: "Sales", tone: "#0284C7" },
];

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

  const clearRecent = () => {
    setRecent([]);
    try {
      window.localStorage.removeItem("goldos-recent-scans");
    } catch {
      // Storage can be blocked; nothing to clear then.
    }
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ScanBarcodeIcon}
        title="Scan"
        accent="& lookup"
        badge={<HeroBadge tone="good">Scanner ready</HeroBadge>}
        sub="USB or Bluetooth scanner, the camera, or type a code and press Enter"
        back={{ href: "/products", label: "Products" }}
        stats={[
          { label: "Last code", value: null, text: code ?? "—", accent: true },
          {
            label: "Result",
            value: null,
            text: lookup.isLoading ? "Looking up…" : lookup.data ? "Found" : lookup.isError ? "Not found" : "—",
            tone: lookup.data ? "good" : lookup.isError ? "bad" : undefined,
          },
          { label: "Recent", value: recent.length, sub: "on this device" },
          { label: "Formats", value: FORMATS.length, sub: "tag · SKU · OG · SINV" },
        ]}
      >
        <ScanInput onScan={onScan} />
      </GoldHero>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {lookup.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : null}
          {lookup.isError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-rose-500/10 px-4 py-3 text-[12.5px] text-rose-900 ring-1 ring-inset ring-rose-500/25">
              <span className="flex size-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-700">
                <AlertCircleIcon size={15} />
              </span>
              <span>
                No product found for <span className="g-metric font-semibold">{code}</span>. Check the tag or try the SKU.
              </span>
            </div>
          ) : null}
          {lookup.data ? (
            <ScanResult data={lookup.data} />
          ) : !lookup.isLoading && !lookup.isError ? (
            <div className="relative flex flex-col items-center overflow-hidden rounded-2xl border border-dashed border-ink/15 bg-paper/70 px-6 py-12 text-center">
              <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-gold/10 blur-[70px]" />
              <span className="relative flex size-12 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
                <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" />
                <ScanBarcodeIcon size={20} />
              </span>
              <p className="relative mt-3 text-[14px] font-semibold text-ink">Waiting for a scan</p>
              <p className="relative mt-0.5 max-w-xs text-[12px] text-ink-4">The field above is focused — just scan a tag and the piece appears here.</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 xl:col-span-4">
          <Card>
            <CardHead
              icon={HistoryIcon}
              title="Recent scans"
              sub="Last 10 on this device"
              action={
                recent.length ? (
                  <button onClick={clearRecent} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-ink-4 hover:bg-bone hover:text-ink">
                    <XIcon size={11} />
                    Clear
                  </button>
                ) : undefined
              }
            />
            {recent.length ? (
              <ul className="divide-y divide-ink/[0.05]">
                {recent.map((r, i) => (
                  <li key={r}>
                    <button onClick={() => onScan(r)} className={cn("group flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors hover:bg-bone/60", r === code && "bg-gold-pale/50")}>
                      <span className="g-metric w-4 text-[10px] text-ink-5">{i + 1}</span>
                      <span className="g-metric flex-1 truncate text-[12px] text-ink-2">{r}</span>
                      <ArrowRightIcon size={11} className="text-ink-5 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[12px] text-ink-4">Nothing scanned yet on this device.</p>
            )}
          </Card>
          <Card>
            <CardHead icon={ScanBarcodeIcon} title="What you can scan" sub="Each code opens the right place" />
            <ul className="divide-y divide-ink/[0.05]">
              {FORMATS.map((f) => (
                <li key={f.k} className="relative flex items-center gap-2.5 px-4 py-2">
                  <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: f.tone }} aria-hidden />
                  <span className="g-metric w-[88px] text-[12px] font-semibold text-ink">{f.k}</span>
                  <span className="flex-1 truncate text-[11px] text-ink-4">{f.ex}</span>
                  <span className="text-[10.5px] font-medium" style={{ color: f.tone }}>
                    → {f.to}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function ScanResult({ data }: { data: Lookup }) {
  const { product, livePrice } = data;
  // The till charges the selling-price override when set, else the live rate.
  const price = product.selling_price_cents ?? livePrice?.amount_cents ?? null;
  const code = encodeURIComponent(product.barcode);
  return (
    <section className="relative animate-fade-in overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(168,138,62,0.35),0_24px_48px_-30px_rgba(126,98,35,0.5)]">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-gold-deep via-gold to-gold-light" aria-hidden />
      <div className="flex flex-wrap items-start gap-4 p-4">
        <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-void">
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(226,194,122,0.35),transparent_60%)]" />
          <GemIcon size={24} className="relative text-gold-light" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="g-metric rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10.5px] font-bold text-void">{product.karat}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
                STATUS_CHIP[product.status] ?? "bg-ink/[0.05] text-ink-3 ring-ink/10"
              )}
            >
              {humanize(product.status)}
            </span>
          </div>
          <h2 className="mt-1 truncate text-[17px] font-semibold text-ink">{product.name}</h2>
          <div className="g-metric mt-0.5 text-[11px] text-ink-4">
            {product.barcode} · {product.sku}
          </div>
        </div>
        <Link href={`/products/${product.id}`} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-bone hover:text-ink">
          Open detail
          <ArrowRightIcon size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-px border-y border-ink/[0.06] bg-ink/[0.05] sm:grid-cols-3">
        <div className="bg-paper px-4 py-2.5">
          <div className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
            <BanknoteIcon size={10} />
            {product.selling_price_cents !== null ? "Fixed price" : "Live price"}
          </div>
          <div className="g-metric mt-0.5 text-[18px] font-semibold text-ink">
            {price !== null ? (
              <>
                {Math.round(price / 100).toLocaleString("en-US")} <span className="text-[10px] font-normal text-ink-5">LKR</span>
              </>
            ) : (
              <span className="text-[12px] font-normal text-amber-700">No rate for {product.karat}</span>
            )}
          </div>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <div className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
            <ScaleIcon size={10} />
            Net weight
          </div>
          <div className="g-metric mt-0.5 text-[18px] font-semibold text-ink">
            {(product.net_mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} <span className="text-[10px] font-normal text-ink-5">g</span>
          </div>
        </div>
        <div className="col-span-2 bg-paper px-4 py-2.5 sm:col-span-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Per gram</div>
          <div className="g-metric mt-0.5 text-[18px] font-semibold text-gold-deep">
            {price !== null && product.net_mg > 0 ? Math.round(price / 100 / (product.net_mg / 1000)).toLocaleString("en-US") : "—"}
            <span className="text-[10px] font-normal text-ink-5"> LKR/g</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 bg-bone/40 px-4 py-2.5">
        {product.status === "SOLD" || product.status === "RETURNED" ? (
          <Link href={`/sales/invoices/lookup/${code}`} className="g-btn g-btn-secondary h-9 px-4 text-sm">
            Find sale
          </Link>
        ) : null}
        {product.status === "IN_STOCK" ? (
          <Link href={`/pos?add=${code}`} className="g-btn g-btn-primary h-9 px-4 text-sm">
            Sell at POS
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </Link>
        ) : null}
      </div>
    </section>
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
      className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row"
    >
      <div className="relative w-full">
        <ScanBarcodeIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold-light" />
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Scan or type barcode, SKU or invoice no…"
          autoComplete="off"
          className="h-10 w-full rounded-lg bg-paper/[0.07] pl-9 pr-4 font-mono text-[14px] text-paper shadow-[inset_0_0_0_1px_rgba(226,194,122,0.4)] transition-shadow placeholder:font-sans placeholder:text-paper/35 focus:outline-none focus:shadow-[inset_0_0_0_1px_#E2C27A,0_0_0_3px_rgba(205,168,83,0.25)]"
        />
      </div>
      <CameraScanButton onDetected={onScan} className="h-10" />
      <button
        type="submit"
        className="home-btn-gold h-10 px-4 text-[13px]"
      >
        Look up
        <ArrowRightIcon size={14} className="g-btn-arrow" />
      </button>
    </form>
  );
}
