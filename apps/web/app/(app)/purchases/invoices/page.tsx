"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { type ItemDraft } from "@/components/purchase-items";
import { Dialog, DialogClose, Label, PurchaseItemsEditor, Spinner, UnitInput, itemMissing, newItem, num } from "@/components/purchase-form";
import { Page, Skeleton } from "@/components/ui";
import { BILL_META, BillChip, Card, CardHead, FilterPills, GoldHero, HeroBadge, MiniStats, RowsSkeleton, heroGold, inputCls as kitInput, th, thead, tr } from "../kit";
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
  // Counts per status and the all-time payables figure — same caches as the overview.
  const counts = useQueries({
    queries: STATUSES.map((s) => ({
      queryKey: ["pur-dash", "bill-state", s],
      queryFn: () => api<{ rows: Invoice[]; total: number }>(`/api/v1/purchases/invoices?status=${s}&limit=1`),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const allTime = useQuery({
    queryKey: ["rep-summary", "all"],
    queryFn: () => api<{ invoices: number; value_cents: number; paid_cents: number; outstanding_cents: number; gold_mg: number }>("/api/v1/purchases/reports/summary?period=all"),
    staleTime: 30_000,
    retry: false,
  });
  const countOf = (s: string) => counts[STATUSES.indexOf(s)]?.data?.total;
  const countsLoading = counts.some((c) => c.isLoading);
  const allCount = countsLoading ? undefined : STATUSES.reduce((n, s) => n + (countOf(s) ?? 0), 0);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const live = rows.filter((r) => r.status !== "VOID");
  const value = live.reduce((n, r) => n + r.total_cents, 0);
  const outstanding = live.reduce((n, r) => n + Math.max(0, r.total_cents - r.paid_cents), 0);
  const paidValue = Math.max(0, value - outstanding);
  const paidShare = value > 0 ? paidValue / value : null;
  const filtered = Boolean(search || fStatus);
  const openBills = (countOf("UNPAID") ?? 0) + (countOf("PARTIAL") ?? 0);
  const a = allTime.data;

  const setFilter = (k: string) => {
    setFStatus(k);
    setPage(1);
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={CreditCardIcon}
        title="Supplier"
        accent="bills"
        badge={openBills > 0 ? <HeroBadge tone="warn">{openBills} to pay</HeroBadge> : <HeroBadge tone="good">All settled</HeroBadge>}
        sub="Stock, ledger and journal post atomically · unpaid and partial balances become supplier payables"
        actions={
          canCreate ? (
            <button type="button" onClick={() => setDialog(true)} className={heroGold}>
              <PlusIcon size={13} />
              New invoice
            </button>
          ) : null
        }
        stats={[
          {
            label: "Owed to suppliers",
            value: a?.outstanding_cents,
            format: (n) => fmt(Math.round(n)),
            unit: "LKR",
            accent: true,
            loading: allTime.isLoading,
            sub: `${openBills} open bill${openBills === 1 ? "" : "s"}`,
          },
          { label: "All bills", value: allCount, loading: countsLoading, sub: a ? `${fmt(a.value_cents)} LKR billed` : "On file" },
          ...STATUSES.map((s) => ({
            label: BILL_META[s]!.label,
            value: countOf(s),
            loading: countsLoading,
            tone: s === "UNPAID" && (countOf(s) ?? 0) > 0 ? ("warn" as const) : s === "PAID" ? ("good" as const) : undefined,
            sub: BILL_META[s]!.hint,
          })),
        ]}
      />

      <Card>
        <CardHead
          icon={CreditCardIcon}
          title="Bills"
          sub={`${total.toLocaleString("en-US")} ${filtered ? "matching" : "on file"} · newest first`}
          action={
            <>
              <label className="relative">
                <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  type="search"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by number…"
                  aria-label="Search invoices"
                  className={cn(kitInput, "w-52 pl-8 [&::-webkit-search-cancel-button]:hidden")}
                />
              </label>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFilter("");
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-ink-4 hover:bg-ink/[0.05] hover:text-ink"
                >
                  <XIcon size={12} /> Clear
                </button>
              ) : null}
              {list.isFetching && !list.isLoading ? <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" /> : null}
            </>
          }
        />
        <div className="overflow-x-auto border-b border-ink/[0.06] px-4 py-2 scrollbar-thin">
          <FilterPills
            value={fStatus}
            onChange={setFilter}
            items={[
              { key: "", label: "All", count: allCount },
              ...STATUSES.map((s) => ({ key: s, label: BILL_META[s]!.label, count: countOf(s), dot: BILL_META[s]!.dot })),
            ]}
          />
        </div>
        <MiniStats
          items={[
            { k: "Value · this page", v: list.data ? `${fmt(value)} LKR` : "—" },
            { k: "Paid · this page", v: list.data ? `${fmt(paidValue)} LKR` : "—", tone: "text-emerald-700" },
            { k: "Due · this page", v: list.data ? `${fmt(outstanding)} LKR` : "—", tone: outstanding > 0 ? "text-amber-700" : undefined },
            { k: "Settled · this page", v: paidShare !== null ? `${Math.round(paidShare * 100)}%` : "—" },
          ]}
        />

        {list.isLoading ? (
          <RowsSkeleton rows={8} />
        ) : list.isError ? (
          <Empty
            icon={<AlertCircleIcon size={22} />}
            title="Couldn't load invoices"
            body="Check the API connection, then retry."
            action={
              <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-9 rounded-lg px-3 text-sm">
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty
            icon={<CreditCardIcon size={22} />}
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
                  className="g-btn g-btn-secondary h-9 rounded-lg px-3 text-sm"
                >
                  Clear filters
                </button>
              ) : canCreate ? (
                <button type="button" onClick={() => setDialog(true)} className="g-btn g-btn-primary h-9 rounded-lg px-3 text-sm">
                  <PlusIcon size={14} /> New invoice
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Invoice</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>Date</th>
                  <th className={cn(th, "text-right")}>Total LKR</th>
                  <th className={cn(th, "text-right")}>Paid LKR</th>
                  <th className={cn(th, "w-[18%]")}>Settlement</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "pr-4")}>
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
                  return (
                    <tr key={r.id} className={cn(tr, "group", isVoid && "opacity-60")}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={`/purchases/invoices/${r.id}`} className={cn("g-metric font-semibold text-ink hover:text-gold-dark", isVoid && "line-through")}>
                          {r.number}
                        </Link>
                      </td>
                      <td className="px-2">
                        <span className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[9px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {initials(r.supplier_name || "?")}
                          </span>
                          <span className="max-w-[14rem] truncate font-medium text-ink-2">{r.supplier_name}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 text-ink-4">{day(r.created_at)}</td>
                      <td className="g-metric px-2 text-right font-semibold text-ink">{fmt(r.total_cents)}</td>
                      <td className="g-metric px-2 text-right text-ink-3">{fmt(r.paid_cents)}</td>
                      <td className="px-2">
                        {isVoid ? (
                          <span className="text-[11px] text-ink-6">—</span>
                        ) : open ? (
                          <span className="block">
                            <span className="flex items-baseline justify-between gap-2 text-[10.5px]">
                              <span className="font-medium text-amber-700">
                                Due <span className="g-metric">{fmt(balance)}</span>
                              </span>
                              <span className="g-metric text-ink-5">{Math.round(share * 100)}%</span>
                            </span>
                            <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-amber-100">
                              <span className="block h-full rounded-full bg-gradient-to-r from-gold-dark to-gold-light" style={{ width: `${share * 100}%` }} />
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                            <CheckCircleIcon size={12} />
                            Settled
                          </span>
                        )}
                      </td>
                      <td className="px-2">
                        <BillChip status={r.status} />
                      </td>
                      <td className="py-1.5 pl-2 pr-4">
                        <Link
                          href={`/purchases/invoices/${r.id}`}
                          aria-label={`Open ${r.number}`}
                          className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-5 ring-1 ring-inset ring-ink/10 transition group-hover:bg-void group-hover:text-gold-light group-hover:ring-void"
                        >
                          <ArrowRightIcon size={12} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 ? <PageNav page={page} onChange={setPage} count={rows.length} total={total} /> : null}
      </Card>

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
