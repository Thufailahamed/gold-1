"use client";

import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { AlertCircleIcon, ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, PackagePlusIcon, ScanBarcodeIcon, SearchIcon, XIcon } from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  MiniStats,
  OgChip,
  RowsSkeleton,
  STAGES,
  grams,
  heroGhost,
  inputCls,
  stageOf,
  statusText,
  th,
  thead,
  tr,
} from "../kit";

type Item = { id: string; number: string; description: string; status: string; net_mg: number; customer_name: string | null; category_name: string | null };
type Paged = { rows: Item[]; total: number };

const STATUSES = ["RECEIVED", "TESTED", "VALUED", "PURCHASED", "AVAILABLE", "RESERVED_FOR_MELTING", "MELTED", "RESOLD", "TRANSFERRED", "VOID"];
const PAGE_SIZE = 20;

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
    queryFn: () => api<Paged>(`/api/v1/oldgold/items?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}${fStatus ? `&status=${fStatus}` : ""}`),
  });

  // Same cache keys as the overview's pipeline; the off-flow states are counted here too.
  const counted = useQueries({
    queries: STATUSES.map((s) => ({
      retry: false,
      staleTime: 30_000,
      queryKey: ["og-dash", "stage", s],
      queryFn: () => api<Paged>(`/api/v1/oldgold/items?status=${s}&limit=1`),
    })),
  });
  const countOf = (s: string) => counted[STATUSES.indexOf(s)]?.data?.total;
  const countsLoading = counted.some((q) => q.isLoading);
  const allCount = counted.reduce((n, q) => n + (q.data?.total ?? 0), 0);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const netMg = rows.reduce((n, r) => n + r.net_mg, 0);
  const filtered = Boolean(search || fStatus);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;

  const setFilter = (s: string) => {
    setFStatus(s);
    setPage(1);
  };
  const clearAll = () => {
    setSearch("");
    setFilter("");
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ArchiveIcon}
        title="Old gold items,"
        accent="traced end to end"
        back={{ href: "/old-gold", label: "Old gold" }}
        sub="Full lifecycle with lineage, intake to melt or resale. Scan an OG- number to jump straight to the item."
        actions={
          <Link href="/old-gold/intake" className={heroGhost}>
            <PackagePlusIcon size={13} /> New intake
          </Link>
        }
        stats={[
          { label: "On file", value: countsLoading ? undefined : allCount, loading: countsLoading, sub: "Every status" },
          ...STAGES.map((s) => ({
            label: s.label,
            value: countOf(s.status),
            loading: countsLoading,
            href: undefined,
            accent: s.status === "AVAILABLE",
            sub: s.hint,
          })),
        ]}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scan.trim()) router.push(`/old-gold/items/barcode/${encodeURIComponent(scan.trim())}`);
          }}
          className="flex gap-2"
        >
          <label className="relative flex-1">
            <span className="sr-only">OG number</span>
            <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gold" />
            <input
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan or type an OG- number and press Enter"
              autoComplete="off"
              className="h-10 w-full rounded-xl bg-paper/10 pl-10 pr-3 font-mono text-[14px] text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.45)] placeholder:font-sans placeholder:text-[13px] placeholder:text-paper/35 focus:outline-none focus:shadow-[inset_0_0_0_2px_#CDA853,0_0_0_4px_rgba(205,168,83,0.2)]"
            />
          </label>
          <button type="submit" disabled={!scan.trim()} className="home-btn-gold h-10 shrink-0 px-4 text-[13px] disabled:opacity-50">
            Look up <ArrowRightIcon size={13} />
          </button>
        </form>
      </GoldHero>

      <Card>
        <CardHead
          icon={ArchiveIcon}
          title="Item register"
          sub={list.data ? `${total.toLocaleString("en-US")} ${fStatus ? statusText(fStatus).toLowerCase() : "items"} · newest first` : "Every lifecycle stage"}
          action={
            <label className="relative">
              <span className="sr-only">Search items</span>
              <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
              <input
                type="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Number or description…"
                className={cn(inputCls, "w-56 pl-7 pr-7 [&::-webkit-search-cancel-button]:hidden")}
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-4 hover:bg-ink/5 hover:text-ink"
                >
                  <XIcon size={11} />
                </button>
              ) : null}
            </label>
          }
        />
        <div className="overflow-x-auto border-b border-ink/[0.06] px-4 py-2 scrollbar-thin">
          <FilterPills
            value={fStatus}
            onChange={setFilter}
            items={[
              { key: "", label: "All", count: countsLoading ? undefined : allCount },
              ...STATUSES.map((s) => ({ key: s, label: statusText(s), dot: stageOf(s)?.dot, count: countOf(s) })),
            ]}
          />
        </div>
        {list.data && rows.length > 0 ? (
          <MiniStats
            items={[
              { k: "On this page", v: rows.length },
              { k: "Net weight", v: `${grams(netMg)} g`, tone: "text-gold-deep" },
              { k: "Average piece", v: `${grams(netMg / rows.length)} g` },
              { k: "With a customer", v: `${rows.filter((r) => r.customer_name).length} / ${rows.length}` },
            ]}
          />
        ) : null}

        {list.isLoading ? (
          <RowsSkeleton rows={8} />
        ) : list.isError ? (
          <Empty
            icon={AlertCircleIcon}
            title="Couldn't load items"
            desc="Check the API connection, then retry."
            action={
              <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty
            icon={ArchiveIcon}
            title={filtered ? "No matching items" : "No items yet"}
            desc={filtered ? "Try another number or clear the status filter." : "Intake an old-gold item to see it here."}
            action={
              filtered ? (
                <button type="button" onClick={clearAll} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                  Clear filters
                </button>
              ) : (
                <Link href="/old-gold/intake" className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                  <PackagePlusIcon size={12} /> New intake
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[620px] text-[12.5px]">
              <thead className={thead}>
                <tr>
                  <th className={cn(th, "pl-4")}>Item</th>
                  <th className={th}>Description</th>
                  <th className={th}>Customer</th>
                  <th className={cn(th, "text-right")}>Net g</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "w-8 pr-4")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isVoid = r.status === "VOID";
                  const href = `/old-gold/items/${r.id}`;
                  return (
                    <tr key={r.id} className={cn(tr, "group cursor-pointer", isVoid && "opacity-60")} onClick={() => router.push(href)}>
                      <td className="relative whitespace-nowrap py-1.5 pl-4 pr-2">
                        <span aria-hidden className={cn("absolute inset-y-1 left-0 w-[3px] rounded-r-full", stageOf(r.status)?.dot ?? "bg-ink/20")} />
                        <Link href={href} onClick={(e) => e.stopPropagation()} className={cn("g-metric font-semibold text-ink group-hover:text-gold-deep", isVoid && "line-through")}>
                          {r.number}
                        </Link>
                      </td>
                      <td className="max-w-[18rem] truncate px-2 py-1.5 text-ink-3">
                        {r.description || "—"}
                        {r.category_name ? <span className="ml-2 rounded bg-gold-pale/70 px-1.5 py-px text-[10px] font-semibold text-gold-deep">{r.category_name}</span> : null}
                      </td>
                      <td className="max-w-[12rem] truncate px-2 py-1.5">{r.customer_name ? <span className="font-medium text-ink">{r.customer_name}</span> : <span className="text-ink-5">—</span>}</td>
                      <td className="g-metric px-2 py-1.5 text-right font-medium text-ink">{grams(r.net_mg)}</td>
                      <td className="px-2 py-1.5">
                        <OgChip status={r.status} />
                      </td>
                      <td className="py-1.5 pl-2 pr-4 text-right">
                        <ArrowRightIcon size={12} className="ml-auto text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-bone/70">
                <tr className="border-t border-ink/10 text-[12px] font-semibold">
                  <td colSpan={3} className="py-1.5 pl-4 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">
                    Page total · {rows.length} items
                  </td>
                  <td className="g-metric px-2 py-1.5 text-right text-gold-deep">{grams(netMg)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[11.5px] text-ink-4">
            <span>
              Showing{" "}
              <span className="g-metric font-medium text-ink">
                {from}–{from + rows.length - 1}
              </span>{" "}
              of <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> items
              {list.isFetching && !list.isLoading ? <span className="ml-2 inline-block size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold align-middle" /> : null}
            </span>
            <span className="flex items-center gap-1.5">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={pagerBtn}>
                <ArrowLeftIcon size={11} /> Prev
              </button>
              <span className="g-metric px-1.5 text-ink-3">
                {page} / {pages}
              </span>
              <button type="button" disabled={rows.length < PAGE_SIZE} onClick={() => setPage(page + 1)} className={pagerBtn}>
                Next <ArrowRightIcon size={11} />
              </button>
            </span>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}

const pagerBtn =
  "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-medium text-ink ring-1 ring-inset ring-ink/10 hover:bg-void hover:text-paper disabled:pointer-events-none disabled:opacity-40";
