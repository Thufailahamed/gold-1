"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, PERMISSIONS } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { lkr } from "@/lib/accounts";
import { cn } from "@/lib/cn";
import { Page, Callout } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  CheckIcon,
  HammerIcon,
  PackageIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";
import {
  CustomerName,
  branchDefault,
  errMsg,
  META,
  RepairChip,
  statusLabel,
  useBranches,
  type Customer,
  type RepairStatus,
} from "./shared";
import {
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  RowsSkeleton,
  ShareBar,
  ago,
  heroGold,
  inputCls as kitInput,
  stamp,
  th,
  thead,
  tr,
} from "../sales/kit";

type RepairListRow = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  item_desc: string;
  repair_type: string;
  estimate_cents: number;
  actual_cents: number | null;
  status: RepairStatus;
  created_at: number;
};

const PAGE_SIZE = 20;

const ALL_STATUSES: ReadonlyArray<RepairStatus> = ["RECEIVED", "IN_PROGRESS", "QC", "READY", "COLLECTED", "CANCELLED"];
const LIVE: ReadonlyArray<RepairStatus> = ["RECEIVED", "IN_PROGRESS", "QC", "READY"];

const REPAIR_TYPES = ["Resize", "Solder", "Polish", "Stone setting", "Clasp replacement", "Re-plating", "Chain repair"];

const inputCls =
  "h-11 w-full rounded-xl bg-paper px-3.5 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]";

const ageDays = (ms: number) => Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));

export default function RepairsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"" | RepairStatus>("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], PERMISSIONS.SALES_CREATE);
  const branches = useBranches();
  const branchRows = branches.data?.rows ?? [];
  const branchName = (id: string) => branchRows.find((b) => b.id === id)?.name ?? "-";

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    for (const [k, v] of Object.entries(extra)) if (v !== "") p.set(k, String(v));
    return p.toString();
  };

  const list = useQuery({
    queryKey: ["repairs", "list", { status, branchId, search, page }],
    queryFn: () => api<{ rows: RepairListRow[]; total: number }>(`/api/v1/repairs?${qs({ page, limit: PAGE_SIZE, status, search: search.trim() })}`),
  });

  // One `limit=1` request per status, reading only `total`; live stages also
  // carry a few rows so the workload can be valued.
  const counts = useQueries({
    queries: ALL_STATUSES.map((s) => ({
      queryKey: ["repairs", "count", s, branchId, LIVE.includes(s) ? 100 : 1],
      queryFn: () => api<{ rows: RepairListRow[]; total: number }>(`/api/v1/repairs?${qs({ status: s, limit: LIVE.includes(s) ? 100 : 1 })}`),
    })),
  });
  const countOf = (s: RepairStatus) => counts[ALL_STATUSES.indexOf(s)]?.data?.total;
  const countsReady = counts.every((c) => c.data !== undefined);
  const activeTotal = countsReady ? LIVE.reduce((n, s) => n + (countOf(s) ?? 0), 0) : null;
  const allTotal = countsReady ? ALL_STATUSES.reduce((n, s) => n + (countOf(s) ?? 0), 0) : null;
  const liveRows = LIVE.flatMap((s) => counts[ALL_STATUSES.indexOf(s)]?.data?.rows ?? []);
  const liveValue = liveRows.reduce((n, r) => n + (r.actual_cents ?? r.estimate_cents), 0);
  const readyValue = liveRows.filter((r) => r.status === "READY").reduce((n, r) => n + (r.actual_cents ?? r.estimate_cents), 0);
  const overdue = liveRows.filter((r) => ageDays(r.created_at) >= 14).length;
  const avgAge = liveRows.length ? liveRows.reduce((n, r) => n + ageDays(r.created_at), 0) / liveRows.length : 0;
  const oldest = [...liveRows].sort((a, b) => a.created_at - b.created_at).slice(0, 5);
  const byType = [...liveRows.reduce((m, r) => m.set(r.repair_type, (m.get(r.repair_type) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxType = Math.max(1, ...byType.map((t) => t[1]));

  // The list endpoint does not filter on `search` yet, so narrow the loaded page here too.
  const term = search.trim().toLowerCase();
  const pageRows = list.data?.rows ?? [];
  const rows = term ? pageRows.filter((r) => [r.number, r.item_desc, r.repair_type].some((v) => v.toLowerCase().includes(term))) : pageRows;
  const total = list.data?.total ?? 0;
  const pristine = total === 0 && !status && !branchId;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = pageRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;

  const pick = (s: "" | RepairStatus) => {
    setStatus(s);
    setPage(1);
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={HammerIcon}
        title="Repairs,"
        accent="bench to collection"
        back={{ href: "/sales", label: "Sales" }}
        badge={activeTotal !== null ? <HeroBadge tone={overdue ? "warn" : "gold"}>{activeTotal} active{branchId ? ` · ${branchName(branchId)}` : ""}</HeroBadge> : null}
        sub="Customer pieces in for repair: intake, workshop, quality check and paid collection."
        actions={
          canCreate ? (
            <button type="button" onClick={() => setCreating(true)} className={heroGold}>
              <PlusIcon size={13} /> New repair
            </button>
          ) : null
        }
        stats={[
          { label: "Active jobs", value: activeTotal, loading: !countsReady, sub: allTotal !== null ? `${allTotal} on file` : undefined },
          { label: "Ready to collect", value: countOf("READY"), accent: true, loading: !countsReady, sub: readyValue ? `${lkr(readyValue)} to take` : "Nothing waiting" },
          { label: "Work in shop", value: countsReady ? liveValue / 100 : null, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR", loading: !countsReady, sub: "Estimates and actuals" },
          { label: "Overdue", value: countsReady ? overdue : null, tone: overdue ? "bad" : "good", loading: !countsReady, sub: "14+ days in shop" },
          { label: "Average age", value: countsReady ? avgAge : null, format: (n) => n.toFixed(1), unit: "days", loading: !countsReady, sub: "Active jobs" },
          { label: "Collected", value: countOf("COLLECTED"), tone: "good", loading: !countsReady, sub: `${countOf("CANCELLED") ?? 0} cancelled` },
        ]}
      >
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {LIVE.map((k, i) => {
            const n = countOf(k);
            const on = status === k;
            const m = META[k];
            return (
              <li key={k} className="relative">
                <button
                  type="button"
                  onClick={() => pick(on ? "" : k)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-all duration-200",
                    on ? "bg-gold/[0.14] ring-gold/50" : "bg-paper/[0.04] ring-paper/10 hover:bg-paper/[0.07] hover:ring-gold/30"
                  )}
                >
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", k === "READY" && n ? "bg-gradient-to-b from-gold-light to-gold text-void" : on ? "bg-paper/[0.12] text-gold-light" : "bg-paper/[0.07] text-gold-light")}>
                    <m.icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-paper/45">
                      {String(i + 1).padStart(2, "0")} · {statusLabel(k)}
                    </span>
                    <span className="flex items-baseline gap-1.5">
                      <span className={cn("g-metric text-[16px] leading-tight", on || (k === "READY" && n) ? "text-gold-light" : "text-paper")}>{n ?? "—"}</span>
                      <span className="truncate text-[10px] text-paper/35">{m.hint}</span>
                    </span>
                  </span>
                </button>
                {i < LIVE.length - 1 ? (
                  <span aria-hidden className="pointer-events-none absolute -right-[9px] top-1/2 z-10 hidden size-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-void text-gold/70 ring-1 ring-gold/25 sm:flex">
                    <ArrowRightIcon size={8} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </GoldHero>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* No overflow clip here: the branch dropdown opens below the header. */}
        <section className="relative flex min-w-0 flex-col rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.28)]">
          <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
          <CardHead
            icon={HammerIcon}
            title="Repair jobs"
            sub={`${total.toLocaleString("en-US")} ${status ? statusLabel(status).toLowerCase() : "jobs"} · newest first`}
            action={
              <>
                <label className="relative">
                  <span className="sr-only">Search repairs</span>
                  <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                  <input
                    id="repair-search"
                    type="search"
                    autoComplete="off"
                    placeholder="Number, item or type…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    className={cn(kitInput, "w-48 pl-7 [&::-webkit-search-cancel-button]:hidden")}
                  />
                </label>
                <Select
                  id="repair-branch-filter"
                  ariaLabel="Branch"
                  size="sm"
                  className="w-44"
                  value={branchId}
                  onChange={(v) => {
                    setBranchId(v);
                    setPage(1);
                  }}
                  loading={branches.isLoading}
                  icon={<Building2Icon size={12} />}
                  options={[{ value: "", label: "All branches" }, ...branchRows.map((b) => ({ value: b.id, label: b.name }))]}
                />
              </>
            }
          />
          <div className="overflow-x-auto border-b border-ink/[0.06] px-4 py-2 scrollbar-thin">
            <FilterPills
              value={status}
              onChange={pick}
              items={[
                { key: "" as const, label: "All", count: allTotal ?? undefined },
                ...ALL_STATUSES.map((k) => ({ key: k, label: statusLabel(k), dot: META[k].dot, count: countOf(k) })),
              ]}
            />
          </div>

          {list.isLoading ? (
            <RowsSkeleton rows={6} />
          ) : list.isError ? (
            <Empty
              icon={AlertCircleIcon}
              title="Could not load repairs"
              desc={errMsg(list.error, "Check the API connection and retry.")}
              action={
                <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={HammerIcon}
              title={pristine ? "No repairs yet" : "No repairs match"}
              desc={pristine ? "Take in a customer's piece to open the first repair job." : "Try a different status, branch or search."}
              action={
                !pristine ? (
                  <button
                    type="button"
                    onClick={() => {
                      pick("");
                      setBranchId("");
                      setSearch("");
                    }}
                    className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]"
                  >
                    Clear filters
                  </button>
                ) : canCreate ? (
                  <button type="button" onClick={() => setCreating(true)} className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                    <PlusIcon size={12} /> New repair
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Job</th>
                    <th className={th}>Item</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Status</th>
                    <th className={cn(th, "text-right")}>In shop</th>
                    <th className={cn(th, "text-right")}>Amount LKR</th>
                    <th className={cn(th, "w-8 pr-4")}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const age = ageDays(r.created_at);
                    const live = r.status !== "COLLECTED" && r.status !== "CANCELLED";
                    const over = r.actual_cents != null && r.actual_cents > r.estimate_cents;
                    const href = `/repairs/${r.id}`;
                    return (
                      <tr key={r.id} className={cn(tr, "group cursor-pointer", !live && "opacity-70")} onClick={() => router.push(href)}>
                        <td className="relative whitespace-nowrap py-1.5 pl-4 pr-2">
                          {r.status === "READY" ? <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-gold-light to-gold" /> : null}
                          <Link href={href} onClick={(e) => e.stopPropagation()} aria-label={`Open repair ${r.number}`} className="g-metric font-semibold text-ink group-hover:text-gold-deep">
                            {r.number}
                          </Link>
                          <span className="block text-[10px] text-ink-5" title={stamp(r.created_at)}>
                            {branchName(r.branch_id)}
                          </span>
                        </td>
                        <td className="max-w-[16rem] px-2 py-1.5">
                          <span className="block truncate text-ink-2">{r.item_desc}</span>
                          <span className="text-[10.5px] font-medium text-gold-deep">{r.repair_type}</span>
                        </td>
                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-ink-3">
                          <CustomerName id={r.customer_id} />
                        </td>
                        <td className="px-2 py-1.5">
                          <RepairChip status={r.status} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {live ? (
                            <span
                              className={cn(
                                "g-metric inline-flex rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
                                age >= 14 ? "bg-rose-500/10 text-rose-800 ring-rose-500/25" : age >= 7 ? "bg-amber-500/10 text-amber-800 ring-amber-500/25" : "bg-ink/[0.04] text-ink-3 ring-ink/10"
                              )}
                            >
                              {age === 0 ? "Today" : `${age}d`}
                            </span>
                          ) : (
                            <span className="text-[11px] text-ink-5">{ago(r.created_at)}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <span className="g-metric text-ink">{r.actual_cents == null ? lkr(r.estimate_cents) : lkr(r.actual_cents)}</span>
                          <span className={cn("block text-[10px]", over ? "font-medium text-amber-700" : "text-ink-5")}>
                            {r.actual_cents == null ? "Estimate" : over ? `Over est. ${lkr(r.estimate_cents)}` : "Actual"}
                          </span>
                        </td>
                        <td className="py-1.5 pl-2 pr-4 text-right">
                          <ArrowRightIcon size={12} className="ml-auto text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pageRows.length > 0 ? (
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[11.5px] text-ink-4">
              <span>
                Showing{" "}
                <span className="g-metric font-medium text-ink">
                  {from}–{from + pageRows.length - 1}
                </span>{" "}
                of <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> jobs
                {list.isFetching && !list.isLoading ? <span className="ml-2 inline-block size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold align-middle" /> : null}
              </span>
              <span className="flex items-center gap-1.5">
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={pagerBtn}>
                  <ArrowLeftIcon size={11} /> Prev
                </button>
                <span className="g-metric px-1.5 text-ink-3">
                  {page} / {pages}
                </span>
                <button type="button" disabled={pageRows.length < PAGE_SIZE} onClick={() => setPage(page + 1)} className={pagerBtn}>
                  Next <ArrowRightIcon size={11} />
                </button>
              </span>
            </div>
          ) : null}
        </section>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={AlertCircleIcon} title="Longest in shop" sub={countsReady ? `${overdue} overdue · avg ${avgAge.toFixed(1)} days` : "Active jobs by age"} />
            {!countsReady ? (
              <RowsSkeleton rows={3} />
            ) : oldest.length === 0 ? (
              <Empty icon={CheckCircleIcon} title="Bench is clear" desc="No active repair jobs right now." />
            ) : (
              <ul className="divide-y divide-ink/[0.05]">
                {oldest.map((r) => {
                  const age = ageDays(r.created_at);
                  return (
                    <li key={r.id}>
                      <Link href={`/repairs/${r.id}`} className="group flex items-center gap-2.5 px-4 py-1.5 transition-colors hover:bg-gold-pale/30">
                        <span className="min-w-0 flex-1">
                          <span className="g-metric block text-[12px] font-semibold text-ink group-hover:text-gold-deep">{r.number}</span>
                          <span className="block truncate text-[10.5px] text-ink-4">{r.item_desc}</span>
                        </span>
                        <span className="text-right">
                          <span className={cn("g-metric block text-[12.5px]", age >= 14 ? "text-rose-700" : age >= 7 ? "text-amber-700" : "text-ink")}>{age}d</span>
                          <span className="block text-[10px] text-ink-5">{statusLabel(r.status)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead icon={ScaleIcon} title="What's on the bench" sub="Active jobs by repair type" />
            {!countsReady ? (
              <RowsSkeleton rows={3} />
            ) : byType.length === 0 ? (
              <Empty icon={HammerIcon} title="Nothing on the bench" desc="Repair types appear once jobs come in." />
            ) : (
              <ul className="space-y-2 p-4">
                {byType.map(([t, n]) => (
                  <li key={t}>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="truncate text-ink-2">{t}</span>
                      <span className="g-metric text-ink">{n}</span>
                    </div>
                    <ShareBar value={(n / maxType) * 100} className="mt-1 h-1" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {creating ? <NewRepairDialog me={me.data} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

const pagerBtn =
  "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-medium text-ink ring-1 ring-inset ring-ink/10 hover:bg-void hover:text-paper disabled:pointer-events-none disabled:opacity-40";

/* ---------------------------------------------------------------- New repair */

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <span className="mb-2 flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-2">
      {children}
      {extra}
    </span>
  );
}

function NewRepairDialog({ me, onClose }: { me: MeData | undefined; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [branchId, setBranchId] = useState(branchDefault);
  const [itemDesc, setItemDesc] = useState("");
  const [weightG, setWeightG] = useState("");
  const [repairType, setRepairType] = useState("");
  const [conditionIn, setConditionIn] = useState("");
  const [estimate, setEstimate] = useState("");

  const branches = useBranches();
  const customers = useQuery({
    queryKey: ["repair-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`),
    enabled: customerSearch.trim().length > 0 && !customer,
  });

  // Intake happens at a branch the user works at; shop-wide roles may pick any.
  const shopWide = hasPermission(me?.permissions ?? [], PERMISSIONS.BRANCHES_MANAGE);
  const branchRows = (branches.data?.rows ?? []).filter((b) => shopWide || (me?.branchIds ?? []).includes(b.id));
  // The cookie branch may not be one the user belongs to; fall back to the first listed.
  const effectiveBranch = branchRows.some((b) => b.id === branchId) ? branchId : branchRows[0]?.id ?? "";

  const weight = Number(weightG);
  const estimateLkr = Number(estimate.replace(/,/g, ""));
  const weightOk = Number.isFinite(weight) && weight > 0 && weight <= 100000;
  const estimateOk = Number.isFinite(estimateLkr) && estimateLkr > 0;
  const ready =
    !!customer && !!effectiveBranch && !!itemDesc.trim() && !!repairType.trim() && !!conditionIn.trim() && weightOk && estimateOk;

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/repairs", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer!.id,
          branchId: effectiveBranch,
          itemDesc: itemDesc.trim(),
          weightG: weight,
          conditionIn: conditionIn.trim(),
          repairType: repairType.trim(),
          estimateLkr,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Repair ${d.number} opened`);
      qc.invalidateQueries({ queryKey: ["repairs"] });
      router.push(`/repairs/${d.id}`);
    },
    onError: (e) => toast.error(errMsg(e, "Could not open the repair")),
  });

  const pending = create.isPending;
  // Escape closes the dialog, unless an open dropdown inside it already handled the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const customerRows = customers.data?.rows ?? [];
  const missing = [
    !customer && "customer",
    !itemDesc.trim() && "item",
    !repairType.trim() && "repair type",
    !weightOk && "weight",
    !estimateOk && "estimate",
    !conditionIn.trim() && "condition",
  ].filter(Boolean) as string[];

  return (
    // The overlay scrolls rather than the dialog body, so dropdowns are never clipped.
    <div
      className="fixed inset-0 z-50 flex animate-fade-in justify-center overflow-y-auto bg-void/60 p-4 backdrop-blur-md"
      onClick={pending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-repair-title"
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex w-full max-w-2xl animate-pop-in flex-col rounded-[24px] bg-paper shadow-5 ring-1 ring-ink/[0.06]"
      >
        {/* Header */}
        <div className="relative overflow-hidden rounded-t-[24px] bg-void px-6 pb-5 pt-6 text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={16} />
          </button>
          <div className="relative flex items-center gap-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.7)]">
              <HammerIcon size={20} />
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Repairs · Intake</div>
              <h2 id="new-repair-title" className="g-display mt-1 text-xl text-paper">
                New repair
              </h2>
            </div>
          </div>
          <p className="relative mt-3 text-xs leading-relaxed text-paper/55">
            Record the piece exactly as it is handed over. Weight and condition are snapshotted on the ticket.
          </p>
        </div>

        <div className="space-y-5 p-6">
          {/* Customer */}
          <div>
            <Label extra={<span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Step 1</span>}>Customer</Label>
            {customer ? (
              <div className="flex items-center gap-3 rounded-2xl bg-gold-pale/60 p-3 ring-1 ring-gold-dark/25">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-void text-[11px] font-bold text-gold-light">
                  {customer.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{customer.name}</span>
                  <span className="block truncate text-xs text-ink-4">
                    <span className="g-metric">{customer.code}</span>
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setCustomer(null)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink-3 hover:bg-paper hover:text-ink"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <div className="group relative">
                  <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 group-focus-within:text-gold-dark" />
                  <input
                    id="repair-customer-search"
                    autoFocus
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name or phone…"
                    autoComplete="off"
                    className={cn(inputCls, "pl-10")}
                  />
                  {customers.isFetching ? (
                    <span className="absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                  ) : null}
                </div>
                {customerSearch.trim() ? (
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-bone/50 p-1.5 ring-1 ring-ink/[0.06] scrollbar-thin">
                    {customerRows.length === 0 && !customers.isFetching ? (
                      <li className="px-3 py-4 text-center text-xs text-ink-4">No customers match “{customerSearch.trim()}”</li>
                    ) : null}
                    {customerRows.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCustomer(c)}
                          className="flex w-full items-center gap-3 rounded-xl bg-paper px-3 py-2 text-left ring-1 ring-ink/[0.06] transition-all hover:-translate-y-px hover:ring-gold-dark/30"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                            <span className="block truncate text-[11px] text-ink-4">
                              <span className="g-metric">{c.code}</span>
                              {c.phone ? ` · ${c.phone}` : ""}
                            </span>
                          </span>
                          <ArrowRightIcon size={13} className="shrink-0 text-ink-5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-4">Search by name or phone, then pick the customer.</p>
                )}
              </div>
            )}
          </div>

          {/* Piece */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label extra={<span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Step 2</span>}>Item</Label>
              <div className="relative">
                <PackageIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  id="repair-item"
                  value={itemDesc}
                  maxLength={500}
                  onChange={(e) => setItemDesc(e.target.value)}
                  placeholder="e.g. 22K ladies ring with red stone"
                  className={cn(inputCls, "pl-10")}
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label>Repair type</Label>
              <input
                id="repair-type"
                value={repairType}
                maxLength={100}
                onChange={(e) => setRepairType(e.target.value)}
                placeholder="Pick one below or type your own"
                autoComplete="off"
                className={inputCls}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REPAIR_TYPES.map((t) => {
                  const on = repairType.trim().toLowerCase() === t.toLowerCase();
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRepairType(t)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-all duration-200",
                        on
                          ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40 shadow-[0_6px_14px_-8px_rgba(205,168,83,0.8)]"
                          : "bg-paper text-ink-3 ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/50 hover:text-ink"
                      )}
                    >
                      {on ? <CheckIcon size={10} /> : null}
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Weight</Label>
              <span className="group relative block">
                <ScaleIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  id="repair-weight"
                  inputMode="decimal"
                  value={weightG}
                  aria-invalid={weightG && !weightOk ? true : undefined}
                  onChange={(e) => setWeightG(e.target.value)}
                  placeholder="0.000"
                  className={cn(inputCls, "g-metric pl-10 pr-14")}
                />
                <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
                  g
                </span>
              </span>
              {weightG && !weightOk ? (
                <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                  <AlertCircleIcon size={12} /> Enter a weight above 0 g
                </span>
              ) : null}
            </div>

            <div>
              <Label>Estimate</Label>
              <span className="group relative block">
                <input
                  id="repair-estimate"
                  inputMode="decimal"
                  value={estimate}
                  aria-invalid={estimate && !estimateOk ? true : undefined}
                  onChange={(e) => setEstimate(e.target.value)}
                  placeholder="0.00"
                  className={cn(inputCls, "g-metric pr-16")}
                />
                <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
                  LKR
                </span>
              </span>
              {estimate && !estimateOk ? (
                <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                  <AlertCircleIcon size={12} /> Enter an estimate above 0
                </span>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <Label extra={<span className="text-[11px] font-normal text-ink-5">{conditionIn.length}/1000</span>}>Condition at intake</Label>
              <textarea
                id="repair-condition"
                value={conditionIn}
                maxLength={1000}
                rows={3}
                onChange={(e) => setConditionIn(e.target.value)}
                placeholder="Scratches, missing stones, breaks: anything the customer should agree to."
                className={cn(inputCls, "h-auto min-h-[5.5rem] resize-y py-3 leading-relaxed")}
              />
            </div>

            <div className="sm:col-span-2">
              <Label>Branch</Label>
              <Select
                id="repair-branch"
                ariaLabel="Branch"
                value={effectiveBranch}
                onChange={setBranchId}
                disabled={branches.isLoading || branchRows.length === 0}
                loading={branches.isLoading}
                placeholder={!branches.isLoading && branchRows.length === 0 ? "No branches available" : "Choose branch"}
                icon={<Building2Icon size={13} />}
                options={branchRows.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          </div>

          {customers.isError ? (
            <Callout tone="danger" title="Could not search customers">
              {errMsg(customers.error, "Please try again.")}
            </Callout>
          ) : null}
          {branches.isError ? (
            <Callout tone="danger" title="Could not load branches">
              {errMsg(branches.error, "Please try again.")}
            </Callout>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-3 rounded-b-[24px] border-t border-ink/[0.06] bg-bone/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-4">
            {ready ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircleIcon size={13} /> Ready to open the ticket
              </span>
            ) : (
              <>Still needed: {missing.join(", ")}</>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="g-btn h-11 rounded-xl px-4 text-sm text-ink-3 hover:bg-paper hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={pending || !ready}
              className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm"
            >
              {pending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                  Opening…
                </>
              ) : (
                <>
                  Open repair
                  <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
