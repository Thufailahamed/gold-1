"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  LayersIcon,
  PackagePlusIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";

type Item = { id: string; number: string; description: string; status: string; net_mg: number; customer_name: string | null };

const STATUSES = ["RECEIVED", "TESTED", "VALUED", "PURCHASED", "AVAILABLE", "RESERVED_FOR_MELTING", "MELTED", "RESOLD", "TRANSFERRED", "VOID"];

// Tag styling per lifecycle status (dot + chip), mirroring the old pill tones.
const STATUS_STYLE: Record<string, { dot: string; chip: string; edge: string }> = {
  RECEIVED: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-600/20", edge: "bg-amber-400" },
  TESTED: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800 ring-sky-600/20", edge: "bg-sky-400" },
  VALUED: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800 ring-sky-600/20", edge: "bg-sky-400" },
  PURCHASED: { dot: "bg-gold", chip: "bg-gold-pale text-gold-deep ring-gold-dark/25", edge: "bg-gold" },
  AVAILABLE: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", edge: "bg-emerald-500" },
  RESERVED_FOR_MELTING: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-600/20", edge: "bg-amber-400" },
  MELTED: { dot: "bg-void", chip: "bg-void text-gold-light ring-gold/25", edge: "bg-void" },
  RESOLD: { dot: "bg-ink-5", chip: "bg-bone text-ink-3 ring-ink/10", edge: "bg-ink-5" },
  TRANSFERRED: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800 ring-sky-600/20", edge: "bg-sky-400" },
  VOID: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-800 ring-rose-600/20", edge: "bg-rose-400" },
};
const NEUTRAL = { dot: "bg-ink-5", chip: "bg-bone text-ink-3 ring-ink/10", edge: "bg-ink-5" };

const PAGE_SIZE = 20;

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const STATUS_OPTIONS = [{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: label(s) }))];

export default function OldGoldItemsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [scan, setScan] = useState("");

  // The old-gold dashboard links here with ?status= to open a pipeline stage.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s && STATUSES.includes(s)) setFStatus(s);
  }, []);

  const list = useQuery({
    queryKey: ["og-items", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Item[]; total: number }>(
        `/api/v1/oldgold/items?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const netMg = rows.reduce((n, r) => n + r.net_mg, 0);
  const filtered = Boolean(search || fStatus);

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean }[] = [
    {
      label: "Items",
      value: list.data ? total.toLocaleString("en-US") : "—",
      sub: fStatus ? `${label(fStatus)} only` : "All on file",
      icon: <ArchiveIcon size={16} />,
    },
    {
      label: "On this page",
      value: list.data ? String(rows.length) : "—",
      sub: `Page ${page}`,
      icon: <LayersIcon size={16} />,
    },
    {
      label: "Net weight",
      value: list.data ? `${grams(netMg)} g` : "—",
      sub: "Items on this page",
      icon: <ScaleIcon size={16} />,
      gold: true,
    },
  ];

  const setFilter = (s: string) => {
    setFStatus(s);
    setPage(1);
  };
  const clearAll = () => {
    setSearch("");
    setFilter("");
  };

  return (
    <Page className="space-y-6">
      {/* Hero */}
      <section className="relative z-30 overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" aria-hidden />
        <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />

        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              Old gold
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Old gold items, <span className="home-gold-text">traced end to end.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Full lifecycle with lineage — intake to melt or resale.
            </p>
          </div>

          {/* Scan lookup */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) router.push(`/old-gold/items/barcode/${encodeURIComponent(scan.trim())}`);
            }}
            className="w-full shrink-0 lg:max-w-md"
          >
            <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">Jump to an item</span>
            <div className="flex gap-2 rounded-2xl bg-paper/[0.05] p-1.5 shadow-[inset_0_0_0_1px_rgba(205,168,83,0.22)] backdrop-blur-sm transition-shadow focus-within:shadow-[inset_0_0_0_1px_rgba(205,168,83,0.6),0_0_0_4px_rgba(205,168,83,0.14)]">
              <label className="relative flex-1">
                <span className="sr-only">OG number</span>
                <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gold" />
                <input
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  placeholder="Scan OG- number…"
                  autoComplete="off"
                  className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 font-mono text-sm text-paper placeholder:text-paper/35 focus:outline-none"
                />
              </label>
              <button type="submit" disabled={!scan.trim()} className="home-btn-gold h-11 shrink-0 px-5 text-sm disabled:opacity-50">
                Look up
                <ArrowRightIcon size={14} />
              </button>
            </div>
          </form>
        </div>

        <div className="relative grid grid-cols-1 gap-px border-t border-paper/[0.08] bg-paper/[0.06] sm:grid-cols-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn(
                "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6",
                s.gold && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                  s.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {list.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-16 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", s.gold ? "text-gold-light" : "text-paper")}>
                    {s.value}
                  </span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 border-t border-paper/[0.08] px-5 py-3 text-xs text-paper/50 sm:px-7 lg:px-8">
          <span className="size-1.5 shrink-0 rounded-full bg-gold" />
          Scan an OG- number to jump straight to the item.
        </div>
      </section>

      {/* Register */}
      <section className={cn("relative rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="relative z-20 flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <ArchiveIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Item register</h2>
                <p className="truncate text-xs text-ink-4">{fStatus ? `${label(fStatus)} only` : "Every lifecycle stage"}</p>
              </div>
            </div>
            <span className="g-metric hidden shrink-0 items-center gap-1.5 rounded-full bg-bone px-3 py-1 text-[11px] text-ink-3 ring-1 ring-ink/[0.06] sm:inline-flex">
              <span className="font-semibold text-ink">{total.toLocaleString("en-US")}</span> on file
              {list.isFetching && !list.isLoading ? (
                <span className="ml-0.5 size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" />
              ) : null}
            </span>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="group relative block w-full md:max-w-sm">
              <span className="sr-only">Search items</span>
              <SearchIcon
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark"
              />
              <input
                type="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search number or description…"
                className="h-11 w-full rounded-xl bg-bone/60 pl-10 pr-9 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] [&::-webkit-search-cancel-button]:hidden"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink"
                >
                  <XIcon size={13} />
                </button>
              ) : null}
            </label>

            <Select
              value={fStatus}
              onChange={setFilter}
              options={STATUS_OPTIONS}
              ariaLabel="Status"
              searchable={false}
              icon={<span className={cn("size-2 rounded-full", fStatus ? (STATUS_STYLE[fStatus] ?? NEUTRAL).dot : "bg-gold")} />}
              className="w-full md:w-60"
            />

            {filtered ? (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-medium text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink md:ml-auto"
              >
                <XIcon size={12} />
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          {list.isLoading ? (
            <div className="space-y-2.5 p-5 sm:p-6">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 rounded-2xl" />
              ))}
            </div>
          ) : list.isError ? (
            <Empty
              icon={<AlertCircleIcon size={24} />}
              title="Couldn't load items"
              body="Check the API connection, then retry."
              action={
                <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={<ArchiveIcon size={24} />}
              title={filtered ? "No matching items" : "No items yet"}
              body={filtered ? "Try another number or clear the status filter." : "Intake an old-gold item to see it here."}
              action={
                filtered ? (
                  <button type="button" onClick={clearAll} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                    Clear filters
                  </button>
                ) : (
                  <Link href="/old-gold/intake" className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                    <PackagePlusIcon size={14} /> New intake
                  </Link>
                )
              }
            />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Customer</th>
                  <th className="!text-right">Net g</th>
                  <th>Status</th>
                  <th className="w-14">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = STATUS_STYLE[r.status] ?? NEUTRAL;
                  const isVoid = r.status === "VOID";
                  return (
                    <tr key={r.id} className={cn("group", isVoid && "opacity-60")}>
                      <td>
                        <Link href={`/old-gold/items/${r.id}`} className="flex items-center gap-3">
                          <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)] transition-transform duration-320 group-hover:scale-105">
                            <ScaleIcon size={15} />
                            <span className={cn("absolute inset-x-0 bottom-0 h-0.5", st.edge)} aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className={cn("g-metric block text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-deep", isVoid && "line-through")}>
                              {r.number}
                            </span>
                            <span className="mt-0.5 block max-w-[18rem] truncate text-[12px] text-ink-4">{r.description || "—"}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        {r.customer_name ? (
                          <span className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                              {initials(r.customer_name)}
                            </span>
                            <span className="max-w-[14rem] truncate font-medium text-ink">{r.customer_name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-ink-5">—</span>
                        )}
                      </td>
                      <td className="!text-right">
                        <span className="g-metric text-[15px] font-medium text-ink">{grams(r.net_mg)}</span>
                        <span className="ml-1 text-[11px] text-ink-5">g</span>
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", st.chip)}>
                          <span className={cn("size-1.5 rounded-full", st.dot === "bg-void" ? "bg-gold-light" : st.dot)} />
                          {label(r.status)}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/old-gold/items/${r.id}`}
                          aria-label={`Open ${r.number}`}
                          className="ml-auto flex size-8 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none"
                        >
                          <ArrowRightIcon size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > 0 ? <PageNav page={page} onChange={setPage} count={rows.length} total={total} /> : null}
      </section>
    </Page>
  );
}

function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-dashed border-ink/15 bg-gradient-to-b from-bone/70 to-paper px-6 py-14 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
        <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
          <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
          {icon}
        </span>
        <h3 className="relative font-sans text-lg font-semibold tracking-normal text-ink">{title}</h3>
        <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">{body}</p>
        {action ? <div className="relative mt-6">{action}</div> : null}
      </div>
    </div>
  );
}

function PageNav({ page, onChange, count, total }: { page: number; onChange: (p: number) => void; count: number; total: number }) {
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const btn =
    "flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-ink transition-all shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-[22px] border-t border-ink/[0.06] bg-bone/40 px-5 py-3 sm:px-6">
      <span className="text-xs text-ink-4">
        Showing <span className="g-metric font-medium text-ink">{from}–{to}</span> of{" "}
        <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> items
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>
          <ArrowLeftIcon size={12} />
          Prev
        </button>
        <span className="g-metric flex h-9 min-w-[4.5rem] items-center justify-center rounded-xl bg-paper px-3 text-xs text-ink-3 ring-1 ring-ink/[0.06]">
          <span className="text-ink">{page}</span>
          <span className="mx-1 text-ink-5">/</span>
          {pages}
        </span>
        <button type="button" disabled={count < PAGE_SIZE} onClick={() => onChange(page + 1)} className={btn}>
          Next
          <ArrowRightIcon size={12} />
        </button>
      </div>
    </div>
  );
}
