"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { type ItemDraft } from "@/components/purchase-items";
import { Dialog, DialogClose, Label, PurchaseItemsEditor, Spinner, UnitInput, itemMissing, newItem, num } from "@/components/purchase-form";
import { Page, Skeleton } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  CreditCardIcon,
  FileTextIcon,
  PackagePlusIcon,
  PlusIcon,
  SearchIcon,
  TruckIcon,
  XIcon,
} from "@/components/icons";

type Invoice = {
  id: string;
  number: string;
  supplier_name: string;
  total_cents: number;
  paid_cents: number;
  status: string;
  created_at: number;
};
type Supplier = { id: string; name: string; code: string };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

const STATUSES = ["UNPAID", "PARTIAL", "PAID", "VOID"];
const FILTERS = ["", ...STATUSES];
const STATUS_LABEL: Record<string, string> = { UNPAID: "Unpaid", PARTIAL: "Part-paid", PAID: "Paid", VOID: "Void" };
const STATUS_STYLE: Record<string, { chip: string; dot: string }> = {
  UNPAID: { chip: "bg-rose-50 text-rose-800 ring-rose-600/20", dot: "bg-rose-500" },
  PARTIAL: { chip: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  PAID: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  VOID: { chip: "bg-bone text-ink-4 ring-ink/10", dot: "bg-ink-5" },
};
const PAGE_SIZE = 20;

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const lkr = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

export default function InvoicesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);

  // The purchasing dashboard links here with ?status= or ?new=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    if (s && STATUSES.includes(s)) setFStatus(s);
    if (q.get("new") === "1") setDialog(true);
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "purchases:create");

  const list = useQuery({
    queryKey: ["invoices", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Invoice[]; total: number }>(
        `/api/v1/purchases/invoices?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const live = rows.filter((r) => r.status !== "VOID");
  const value = live.reduce((n, r) => n + r.total_cents, 0);
  const outstanding = live.reduce((n, r) => n + Math.max(0, r.total_cents - r.paid_cents), 0);
  const paidValue = Math.max(0, value - outstanding);
  const paidShare = value > 0 ? paidValue / value : null;
  const openCount = live.filter((r) => r.total_cents - r.paid_cents > 0).length;
  const filtered = Boolean(search || fStatus);

  const stats: { label: string; value: string; sub: string; icon: ReactNode; bar?: number | null; gold?: boolean; warn?: boolean }[] = [
    {
      label: "Invoices",
      value: list.data ? total.toLocaleString("en-US") : "—",
      sub: fStatus ? `${STATUS_LABEL[fStatus]} only` : "All on file",
      icon: <FileTextIcon size={16} />,
    },
    {
      label: "Page value",
      value: list.data ? `LKR ${fmt(value)}` : "—",
      sub: `${rows.length} on this page, voids excluded`,
      icon: <CreditCardIcon size={16} />,
      gold: true,
    },
    {
      label: "Paid",
      value: list.data ? `LKR ${fmt(paidValue)}` : "—",
      sub: paidShare !== null ? `${Math.round(paidShare * 100)}% of page value` : "Nothing billed yet",
      icon: <BanknoteIcon size={16} />,
      bar: paidShare,
    },
    {
      label: "Outstanding",
      value: list.data ? `LKR ${fmt(outstanding)}` : "—",
      sub: openCount ? `${openCount} invoice${openCount === 1 ? "" : "s"} owed to suppliers` : "Fully settled",
      icon: <AlertCircleIcon size={16} />,
      warn: outstanding > 0,
    },
  ];

  const setFilter = (k: string) => {
    setFStatus(k);
    setPage(1);
  };

  return (
    <Page className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" aria-hidden />
        <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />

        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              Purchasing · Invoices
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Purchase invoices, <span className="home-gold-text">posted as one.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">Stock, ledger and journal post atomically.</p>
          </div>
          {canCreate ? (
            <button type="button" onClick={() => setDialog(true)} className="home-btn-gold h-11 shrink-0 self-start px-5 text-sm lg:self-auto">
              <PlusIcon size={15} />
              New invoice
            </button>
          ) : null}
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
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
                    : s.warn
                      ? "bg-rose-400/15 text-rose-200 ring-rose-300/25"
                      : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {list.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-24 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", s.gold ? "text-gold-light" : s.warn ? "text-rose-200" : "text-paper")}>
                    {s.value}
                  </span>
                )}
                {s.bar !== undefined && s.bar !== null ? (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700 ease-brand"
                      style={{ width: `${Math.round(s.bar * 100)}%` }}
                    />
                  </span>
                ) : null}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 border-t border-paper/[0.08] px-5 py-3 text-xs text-paper/50 sm:px-7 lg:px-8">
          <span className="size-1.5 shrink-0 rounded-full bg-gold" />
          Unpaid and partial balances become supplier payables on the ledger.
        </div>
      </section>

      {/* Invoices */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <CreditCardIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Invoices</h2>
                <p className="truncate text-xs text-ink-4">{fStatus ? `${STATUS_LABEL[fStatus]} only, newest first` : "All statuses, newest first"}</p>
              </div>
            </div>
            <span className="g-metric hidden shrink-0 items-center gap-1.5 rounded-full bg-bone px-3 py-1 text-[11px] text-ink-3 ring-1 ring-ink/[0.06] sm:inline-flex">
              <span className="font-semibold text-ink">{total.toLocaleString("en-US")}</span> on file
              {list.isFetching && !list.isLoading ? (
                <span className="ml-0.5 size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" />
              ) : null}
            </span>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="group relative block w-full lg:max-w-sm">
              <span className="sr-only">Search invoices</span>
              <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark" />
              <input
                type="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by number…"
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

            <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
              <div role="tablist" aria-label="Status" className="relative grid min-w-max grid-cols-5 rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/5)] rounded-lg bg-void shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_8px_18px_-10px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand"
                  style={{ transform: `translateX(${Math.max(0, FILTERS.indexOf(fStatus)) * 100}%)` }}
                />
                {FILTERS.map((k) => {
                  const active = k === fStatus;
                  return (
                    <button
                      key={k || "all"}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilter(k)}
                      className={cn(
                        "relative inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-medium transition-colors duration-200",
                        active ? "text-paper" : "text-ink-4 hover:text-ink"
                      )}
                    >
                      {k ? <span className={cn("size-1.5 rounded-full", STATUS_STYLE[k]?.dot)} /> : null}
                      {k ? STATUS_LABEL[k] : "All"}
                    </button>
                  );
                })}
              </div>
            </div>
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
              title="Couldn't load invoices"
              body="Check the API connection, then retry."
              action={
                <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={<CreditCardIcon size={24} />}
              title={filtered ? "No matching invoices" : "No invoices yet"}
              body={filtered ? "Try another number or clear the status filter." : "Post the first purchase invoice."}
              action={
                filtered ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setFilter("");
                    }}
                    className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm"
                  >
                    Clear filters
                  </button>
                ) : canCreate ? (
                  <button type="button" onClick={() => setDialog(true)} className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                    <PlusIcon size={14} /> New invoice
                  </button>
                ) : null
              }
            />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Supplier</th>
                  <th className="!text-right">Total LKR</th>
                  <th>Settlement</th>
                  <th>Status</th>
                  <th className="w-14">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isVoid = r.status === "VOID";
                  const balance = Math.max(0, r.total_cents - r.paid_cents);
                  const open = balance > 0 && !isVoid;
                  const share = r.total_cents > 0 ? Math.min(Math.max(r.paid_cents / r.total_cents, 0), 1) : 0;
                  const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.VOID!;
                  return (
                    <tr key={r.id} className={cn("group", isVoid && "opacity-60")}>
                      <td>
                        <Link href={`/purchases/invoices/${r.id}`} className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-320 group-hover:scale-105",
                              open ? "bg-rose-50 text-rose-700 ring-1 ring-rose-600/15" : "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]"
                            )}
                          >
                            <FileTextIcon size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className={cn("g-metric block text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-deep", isVoid && "line-through")}>
                              {r.number}
                            </span>
                            <span className="mt-0.5 block whitespace-nowrap text-[11px] text-ink-5">{day(r.created_at)}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {initials(r.supplier_name || "?")}
                          </span>
                          <span className="max-w-[14rem] truncate font-medium text-ink">{r.supplier_name}</span>
                        </span>
                      </td>
                      <td className="!text-right">
                        <span className="g-metric text-[15px] font-medium text-ink">{fmt(r.total_cents)}</span>
                      </td>
                      <td className="min-w-[10rem]">
                        {isVoid ? (
                          <span className="text-xs text-ink-5">—</span>
                        ) : open ? (
                          <span className="block">
                            <span className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="font-medium text-rose-700">
                                Due <span className="g-metric">{fmt(balance)}</span>
                              </span>
                              <span className="g-metric text-ink-5">{Math.round(share * 100)}%</span>
                            </span>
                            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-rose-100">
                              <span className="block h-full rounded-full bg-gradient-to-r from-gold-dark to-gold-light" style={{ width: `${share * 100}%` }} />
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <CheckCircleIcon size={13} />
                            Settled
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", st.chip)}>
                          <span className={cn("size-1.5 rounded-full", st.dot)} />
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/purchases/invoices/${r.id}`}
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

      {dialog ? <NewInvoiceDialog onClose={() => setDialog(false)} /> : null}
    </Page>
  );
}

/* ---------- New invoice ---------- */

function NewInvoiceDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100"),
  });
  const banks = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => api<{ id: string; name: string; account_code: string; is_active: number }[]>("/api/v1/bank-accounts"),
  });
  const [supplierId, setSupplierId] = useState("");
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>(() => [newItem()]);

  const subtotal = items.reduce((n, it) => n + (num(it.costLkr) > 0 ? num(it.costLkr) : 0), 0);
  const chargesN = charges === "" ? 0 : num(charges);
  const paidN = paid === "" ? 0 : num(paid);
  const totalN = subtotal + (chargesN > 0 ? chargesN : 0);
  const chargesOk = charges === "" || chargesN >= 0;
  const paidOk = paid === "" || (paidN >= 0 && paidN <= totalN);
  const paying = paidN > 0;
  const incomplete = items.filter((it) => itemMissing(it).length > 0).length;
  const ready = !!supplierId && items.length > 0 && incomplete === 0 && chargesOk && paidOk && (!paying || !!bankAccountId);

  const missing = [
    !supplierId && "supplier",
    incomplete > 0 && `${incomplete} item${incomplete === 1 ? "" : "s"}`,
    !chargesOk && "valid charges",
    !paidOk && (paidN > totalN ? "payment within total" : "valid payment"),
    paying && !bankAccountId && "pay-from account",
  ].filter(Boolean) as string[];

  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/invoices", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId: branchDefault(),
          chargesLkr: chargesN,
          paidLkr: paidN,
          paidBankAccountId: paid === "" ? undefined : bankAccountId,
          items: items.map((it) => ({
            categoryId: it.categoryId,
            metalTypeId: it.metalTypeId,
            purityId: it.purityId,
            name: it.name,
            grossG: num(it.grossG),
            costLkr: it.costLkr === "" ? 0 : num(it.costLkr),
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Invoice created");
      qc.invalidateQueries({ queryKey: ["invoices"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });
  const pending = create.isPending;

  return (
    <Dialog
      wide
      icon={<PackagePlusIcon size={20} />}
      kicker="Purchasing · Direct intake"
      title="New purchase invoice"
      intro="Posting creates the products, stock movements, supplier ledger and journal entries in one step."
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <p className="text-xs text-ink-4">
            {ready ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircleIcon size={13} /> Ready to post
              </span>
            ) : (
              <>Still needed: {missing.join(", ")}</>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <DialogClose onClose={onClose} pending={pending} />
            <button type="button" onClick={() => create.mutate()} disabled={pending || !ready} className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm">
              {pending ? (
                <>
                  <Spinner /> Posting…
                </>
              ) : (
                <>
                  Post invoice <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                </>
              )}
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-5 p-6">
        <div>
          <Label>Supplier</Label>
          <Select
            ariaLabel="Supplier"
            value={supplierId}
            onChange={setSupplierId}
            loading={suppliers.isLoading}
            searchable
            icon={<TruckIcon size={13} />}
            placeholder={suppliers.isLoading ? "Loading suppliers…" : "Choose supplier"}
            options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name, hint: s.code }))}
          />
        </div>

        <PurchaseItemsEditor items={items} onChange={setItems} costLabel="Cost" />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Charges & payment */}
          <div className="space-y-4 rounded-2xl bg-bone/50 p-4 ring-1 ring-ink/[0.06]">
            <div>
              <Label extra={<span className="text-[11px] font-normal text-ink-5">Optional</span>}>Additional charges</Label>
              <UnitInput value={charges} onChange={setCharges} unit="LKR" placeholder="0.00" invalid={!chargesOk} icon={<BanknoteIcon size={14} />} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Paid now</Label>
                <UnitInput value={paid} onChange={setPaid} unit="LKR" placeholder="0.00" invalid={!paidOk} />
                {paidN > totalN ? <span className="mt-1.5 block text-[11px] font-medium text-rose-700">More than the invoice total</span> : null}
              </div>
              <div>
                <Label>Pay from</Label>
                <Select
                  ariaLabel="Pay from"
                  value={bankAccountId}
                  onChange={setBankAccountId}
                  loading={banks.isLoading}
                  invalid={paying && !bankAccountId}
                  icon={<BanknoteIcon size={13} />}
                  placeholder="Choose an account"
                  options={(banks.data ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name, hint: b.account_code }))}
                />
              </div>
            </div>
            <p className="text-[11px] text-ink-4">Leave Paid now blank to post the full amount as payable to the supplier.</p>
          </div>

          {/* Summary */}
          <div className="relative overflow-hidden rounded-2xl bg-void p-4 text-paper ring-1 ring-gold/15">
            <div className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full bg-gold/15 blur-[60px]" aria-hidden />
            <div className="relative text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/45">Invoice summary</div>
            <dl className="relative mt-3 space-y-2 text-[13px]">
              <Row k={`Items (${items.length})`} v={`LKR ${lkr(subtotal)}`} />
              <Row k="Charges" v={`LKR ${lkr(chargesN > 0 ? chargesN : 0)}`} />
              <div className="my-2 h-px bg-paper/10" />
              <Row k="Total" v={`LKR ${lkr(totalN)}`} strong />
              <Row k="Paid now" v={`LKR ${lkr(paidN > 0 ? paidN : 0)}`} />
              <Row k="To payables" v={`LKR ${lkr(Math.max(0, totalN - (paidN > 0 ? paidN : 0)))}`} warn={totalN - paidN > 0} />
            </dl>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Row({ k, v, strong, warn }: { k: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-paper/55", strong && "font-semibold text-paper")}>{k}</dt>
      <dd className={cn("g-metric", strong ? "text-lg text-gold-light" : warn ? "text-amber-200" : "text-paper")}>{v}</dd>
    </div>
  );
}

/* ---------- Shared bits ---------- */

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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] bg-bone/40 px-5 py-3 sm:px-6">
      <span className="text-xs text-ink-4">
        Showing <span className="g-metric font-medium text-ink">{from}–{to}</span> of{" "}
        <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> invoices
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
