"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Pager, Modal, controlClass } from "@/components/ui";
import { HammerIcon, PackageIcon, PlusIcon, SearchIcon, UserCheckIcon, XIcon } from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  ORDER_META,
  ORDER_STATUSES,
  OPEN_STATUSES,
  OrderChip,
  RowsSkeleton,
  TypeChip,
  ago,
  heroGold,
  inputCls,
  th,
  thead,
  tr,
} from "../kit";

type Order = { id: string; number: string; type: string; design: string; status: string; customer_name: string | null; created_at: number };
type Customer = { id: string; name: string; code: string };
type Summary = { byStatus: { status: string; n: number }[] };

const STATUSES: readonly string[] = ORDER_STATUSES;
const PAGE = 25;

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

export default function MfgOrdersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const [type, setType] = useState("INTERNAL");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [design, setDesign] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();

  // The manufacturing dashboard links here with ?status= or ?new=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    if (s && STATUSES.includes(s)) setFStatus(s);
    if (q.get("new") === "1") setDialog(true);
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "mfg:create");

  const list = useQuery({
    queryKey: ["mfg-orders", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Order[]; total: number }>(`/api/v1/manufacturing/orders?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE}${fStatus ? `&status=${fStatus}` : ""}`),
  });
  // Status counts come from the all-time summary, the same cache the overview uses.
  const summary = useQuery({
    queryKey: ["mfg-summary", "all"],
    queryFn: () => api<Summary>("/api/v1/manufacturing/reports/summary?period=all"),
    staleTime: 30_000,
    retry: false,
  });
  const customers = useQuery({
    queryKey: ["mfg-customers", customerSearch],
    queryFn: () => api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`),
    enabled: customerSearch.length > 0,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/manufacturing/orders", {
        method: "POST",
        body: JSON.stringify({
          type,
          customerId: type === "CUSTOMER" ? customerId || undefined : undefined,
          branchId: branchDefault(),
          design,
          description: description || undefined,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Order ${d.number} created`);
      setDialog(false);
      setDesign("");
      setDescription("");
      setCustomerId("");
      qc.invalidateQueries({ queryKey: ["mfg-orders"] });
      qc.invalidateQueries({ queryKey: ["mfg-summary"] });
      qc.invalidateQueries({ queryKey: ["mfg-dash"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const by = new Map((summary.data?.byStatus ?? []).map((r) => [r.status, r.n]));
  const all = (summary.data?.byStatus ?? []).reduce((n, r) => n + r.n, 0);
  const open = OPEN_STATUSES.reduce((n, s) => n + (by.get(s) ?? 0), 0);
  const failed = by.get("QC_FAILED") ?? 0;
  const sLoading = summary.isLoading;
  const filtered = !!search || !!fStatus;
  const pageCustomers = rows.filter((r) => r.type === "CUSTOMER").length;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={HammerIcon}
        title="Workshop"
        accent="orders"
        badge={failed > 0 ? <HeroBadge tone="bad">{failed} need rework</HeroBadge> : <HeroBadge>Lineage-tracked</HeroBadge>}
        sub="Refined lots in, finished jewellery out · materials allocate from approved melting lots"
        actions={
          canCreate ? (
            <button type="button" onClick={() => setDialog(true)} className={heroGold}>
              <PlusIcon size={13} />
              New order
            </button>
          ) : null
        }
        stats={[
          { label: "All orders", value: summary.data ? all : undefined, accent: true, loading: sLoading, sub: `${by.get("VOID") ?? 0} void` },
          { label: "Open", value: summary.data ? open : undefined, loading: sLoading, sub: "Draft → QC passed" },
          { label: "Draft", value: by.get("DRAFT") ?? (summary.data ? 0 : undefined), loading: sLoading, sub: ORDER_META.DRAFT!.hint },
          { label: "On the bench", value: summary.data ? (by.get("ALLOCATED") ?? 0) + (by.get("IN_PRODUCTION") ?? 0) : undefined, loading: sLoading, sub: "Allocated or in production" },
          { label: "QC failed", value: summary.data ? failed : undefined, tone: failed > 0 ? "bad" : undefined, loading: sLoading, sub: "Back to the bench" },
          { label: "Ready to finish", value: summary.data ? by.get("QC_PASSED") ?? 0 : undefined, tone: "warn", loading: sLoading, sub: "QC passed" },
          { label: "Complete", value: summary.data ? by.get("COMPLETE") ?? 0 : undefined, tone: "good", loading: sLoading, sub: "In stock / delivered" },
        ]}
      />

      <Card>
        <CardHead
          icon={HammerIcon}
          title="Order book"
          sub={`${total.toLocaleString("en-US")} ${filtered ? "matching" : "on file"} · ${pageCustomers} customer commission${pageCustomers === 1 ? "" : "s"} on this page`}
          action={
            <>
              <label className="relative">
                <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  placeholder="Search number or design…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Search orders"
                  className={cn(inputCls, "w-56 pl-8")}
                />
              </label>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFStatus("");
                    setPage(1);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-ink-4 hover:bg-ink/[0.05] hover:text-ink"
                >
                  <XIcon size={12} /> Clear
                </button>
              ) : null}
            </>
          }
        />
        <div className="overflow-x-auto border-b border-ink/20 px-4 py-2 scrollbar-thin">
          <FilterPills
            value={fStatus}
            onChange={(s) => {
              setFStatus(s);
              setPage(1);
            }}
            items={[
              { key: "", label: "All", count: summary.data ? all : undefined },
              ...STATUSES.map((s) => ({ key: s, label: ORDER_META[s]!.label, count: summary.data ? by.get(s) ?? 0 : undefined, dot: ORDER_META[s]!.dot })),
            ]}
          />
        </div>
        {list.isLoading ? (
          <RowsSkeleton rows={8} />
        ) : list.isError ? (
          <Empty icon={HammerIcon} title="Failed to load" desc="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <Empty
            icon={PackageIcon}
            title="No orders"
            desc={filtered ? "Nothing matches these filters." : "Create the first manufacturing order."}
            action={
              canCreate && !filtered ? (
                <button type="button" onClick={() => setDialog(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-void px-3 text-[12px] font-semibold text-gold-light">
                  <PlusIcon size={12} /> New
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Order</th>
                  <th className={th}>Type</th>
                  <th className={th}>Design</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "pr-4 text-right")}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={cn(tr, o.status === "QC_FAILED" && "bg-rose-50/40", o.status === "VOID" && "opacity-60")}>
                    <td className="py-1.5 pl-4 pr-2">
                      <Link href={`/manufacturing/orders/${o.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-2">
                      <TypeChip type={o.type} />
                    </td>
                    <td className="max-w-[260px] truncate px-2 font-medium text-ink-2" title={o.design}>
                      {o.design}
                    </td>
                    <td className="max-w-[180px] truncate px-2 text-ink-3">{o.customer_name ?? <span className="text-ink-6">—</span>}</td>
                    <td className="px-2">
                      <OrderChip status={o.status} />
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right text-[11px] text-ink-4" title={new Date(o.created_at).toLocaleString()}>
                      {ago(o.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-ink/20 px-4 py-2">
          <Pager page={page} onChange={setPage} pageSize={PAGE} count={rows.length} total={total} unit="orders" />
        </div>
      </Card>

      {dialog ? (
        <Modal
          kicker="Workshop"
          title="New manufacturing order"
          onClose={() => setDialog(false)}
          onSubmit={() => create.mutate()}
          pending={create.isPending}
          submitDisabled={!design || (type === "CUSTOMER" && !customerId)}
          submitLabel="Create"
        >
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { t: "INTERNAL", label: "For stock", hint: "Goes to inventory", icon: PackageIcon },
                { t: "CUSTOMER", label: "For a customer", hint: "Commissioned piece", icon: UserCheckIcon },
              ] as const
            ).map((x) => (
              <button
                key={x.t}
                type="button"
                onClick={() => setType(x.t)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition",
                  type === x.t ? "bg-void text-paper ring-void" : "bg-paper text-ink ring-ink/20 hover:ring-gold/50"
                )}
              >
                <x.icon size={15} className={type === x.t ? "text-gold-light" : "text-ink-4"} />
                <span className="leading-tight">
                  <span className="block text-[13px] font-semibold">{x.label}</span>
                  <span className={cn("block text-[11px]", type === x.t ? "text-paper/50" : "text-ink-4")}>{x.hint}</span>
                </span>
              </button>
            ))}
          </div>
          {type === "CUSTOMER" ? (
            <div className="space-y-2">
              <input placeholder="Search customers…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className={controlClass} />
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={controlClass}>
                <option value="">{customerSearch ? "Select customer…" : "Type above to find a customer"}</option>
                {(customers.data?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="block text-sm text-ink-2">
            Design
            <input value={design} onChange={(e) => setDesign(e.target.value)} className={controlClass} placeholder="e.g. 22K bangle, floral" />
          </label>
          <label className="block text-sm text-ink-2">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={controlClass} placeholder="Optional — size, stones, finish" />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
