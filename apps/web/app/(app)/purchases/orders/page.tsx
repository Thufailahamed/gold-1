"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { type ItemDraft } from "@/components/purchase-items";
import { Dialog, DialogClose, Label, PurchaseItemsEditor, Spinner, UnitInput, inputCls, itemMissing, newItem, num } from "@/components/purchase-form";
import { Page, Skeleton } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  CircleSlashIcon,
  FileTextIcon,
  LayersIcon,
  PackageIcon,
  PackagePlusIcon,
  PlusIcon,
  SearchIcon,
  TruckIcon,
  XIcon,
} from "@/components/icons";

type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
type Supplier = { id: string; name: string; code: string };

const ORDER_STATUSES = ["DRAFT", "SENT", "RECEIVED", "CANCELLED"];
const FILTERS = ["", ...ORDER_STATUSES];
const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", RECEIVED: "Received", CANCELLED: "Cancelled" };
const STATUS_STYLE: Record<string, { chip: string; dot: string }> = {
  DRAFT: { chip: "bg-bone text-ink-2 ring-ink/10", dot: "bg-ink-4" },
  SENT: { chip: "bg-sky-50 text-sky-800 ring-sky-600/20", dot: "bg-sky-500" },
  RECEIVED: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  CANCELLED: { chip: "bg-rose-50 text-rose-800 ring-rose-600/20", dot: "bg-rose-500" },
};
const PAGE_SIZE = 20;

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";
const lkr = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const [receiving, setReceiving] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  // The purchasing dashboard links here with ?status= or ?new=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    if (s && ORDER_STATUSES.includes(s)) setFStatus(s);
    if (q.get("new") === "1") setDialog(true);
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "purchases:create");
  const canCancel = hasPermission(me.data?.permissions ?? [], "purchases:cancel");

  const list = useQuery({
    queryKey: ["orders", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Order[]; total: number }>(
        `/api/v1/purchases/orders?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const open = rows.filter((r) => r.status === "DRAFT" || r.status === "SENT").length;
  const itemCount = rows.reduce((n, r) => n + r.items, 0);
  const filtered = Boolean(search || fStatus);

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean; warn?: boolean }[] = [
    {
      label: "Orders",
      value: list.data ? total.toLocaleString("en-US") : "â€”",
      sub: fStatus ? `${STATUS_LABEL[fStatus]} only` : "All on file",
      icon: <FileTextIcon size={16} />,
    },
    { label: "On this page", value: list.data ? String(rows.length) : "â€”", sub: `Page ${page}`, icon: <LayersIcon size={16} /> },
    {
      label: "Open drafts",
      value: list.data ? String(open) : "â€”",
      sub: open ? "Draft or sent, awaiting receipt" : "Nothing waiting",
      icon: <TruckIcon size={16} />,
      gold: true,
    },
    { label: "Items ordered", value: list.data ? itemCount.toLocaleString("en-US") : "â€”", sub: "Lines on this page", icon: <PackageIcon size={16} /> },
  ];

  const setFilter = (s: string) => {
    setFStatus(s);
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
              Purchasing Â· Orders
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Purchase orders, <span className="home-gold-text">received in one step.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Drafts â€” receiving posts stock, ledger and journal atomically.
            </p>
          </div>
          {canCreate ? (
            <button type="button" onClick={() => setDialog(true)} className="home-btn-gold h-11 shrink-0 self-start px-5 text-sm lg:self-auto">
              <PlusIcon size={15} />
              New order
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
                    : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {list.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-12 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", s.gold ? "text-gold-light" : "text-paper")}>{s.value}</span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 border-t border-paper/[0.08] px-5 py-3 text-xs text-paper/50 sm:px-7 lg:px-8">
          <span className="size-1.5 shrink-0 rounded-full bg-gold" />
          Receiving a draft creates products, stock movements and journal entries in one step.
        </div>
      </section>

      {/* Orders */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <FileTextIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Purchase orders</h2>
                <p className="truncate text-xs text-ink-4">{fStatus ? `${STATUS_LABEL[fStatus]} only` : "Every status"}</p>
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
              <span className="sr-only">Search orders</span>
              <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark" />
              <input
                type="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by numberâ€¦"
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
              title="Couldn't load orders"
              body="Check the API connection, then retry."
              action={
                <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={<FileTextIcon size={24} />}
              title={filtered ? "No matching orders" : "No orders yet"}
              body={filtered ? "Try another number or clear the status filter." : "Create the first purchase order."}
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
                    <PlusIcon size={14} /> New order
                  </button>
                ) : null
              }
            />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Supplier</th>
                  <th className="!text-right">Items</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const st = STATUS_STYLE[o.status] ?? STATUS_STYLE.DRAFT!;
                  const isOpen = o.status === "DRAFT" || o.status === "SENT";
                  const cancelled = o.status === "CANCELLED";
                  return (
                    <tr key={o.id} className={cn("group", cancelled && "opacity-60")}>
                      <td>
                        <span className="flex items-center gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)] transition-transform duration-320 group-hover:scale-105">
                            <FileTextIcon size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className={cn("g-metric block text-[13px] font-semibold text-ink", cancelled && "line-through")}>{o.number}</span>
                            <span className="mt-0.5 block whitespace-nowrap text-[11px] text-ink-5">{day(o.created_at)}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {initials(o.supplier_name || "?")}
                          </span>
                          <span className="max-w-[16rem] truncate font-medium text-ink">{o.supplier_name}</span>
                        </span>
                      </td>
                      <td className="!text-right">
                        <span className="g-metric text-[15px] font-medium text-ink">{o.items}</span>
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", st.chip)}>
                          <span className={cn("size-1.5 rounded-full", st.dot)} />
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center justify-end gap-1.5">
                          {isOpen && canCreate ? (
                            <button
                              type="button"
                              onClick={() => setReceiving(o)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-void px-3 text-xs font-medium text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3)] transition-all hover:-translate-y-px hover:text-gold-light"
                            >
                              <PackagePlusIcon size={13} className="text-gold-light" />
                              Receive
                            </button>
                          ) : null}
                          {isOpen && canCancel ? (
                            <button
                              type="button"
                              onClick={() => setCancelling(o)}
                              aria-label={`Cancel ${o.number}`}
                              title="Cancel order"
                              className="flex size-8 items-center justify-center rounded-full text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all hover:bg-rose-50 hover:text-rose-700 hover:shadow-[inset_0_0_0_1px_rgba(225,29,72,0.3)]"
                            >
                              <CircleSlashIcon size={14} />
                            </button>
                          ) : null}
                          {!isOpen ? <span className="text-xs text-ink-5">â€”</span> : null}
                        </span>
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

      {dialog ? <NewOrderDialog onClose={() => setDialog(false)} /> : null}
      {receiving ? <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} /> : null}
      {cancelling ? <CancelDialog order={cancelling} onClose={() => setCancelling(null)} /> : null}
    </Page>
  );
}

/* ---------- New order ---------- */

function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100"),
  });
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>(() => [newItem()]);

  const incomplete = items.filter((it) => itemMissing(it).length > 0).length;
  const ready = !!supplierId && items.length > 0 && incomplete === 0;
  const grossTotal = items.reduce((n, it) => n + (num(it.grossG) > 0 ? num(it.grossG) : 0), 0);
  const costTotal = items.reduce((n, it) => n + (num(it.costLkr) > 0 ? num(it.costLkr) : 0), 0);

  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId: branchDefault(),
          notes: notes || undefined,
          items: items.map((it) => ({
            categoryId: it.categoryId,
            metalTypeId: it.metalTypeId || undefined,
            purityId: it.purityId,
            name: it.name || undefined,
            grossG: num(it.grossG),
            estCostLkr: num(it.costLkr),
            notes: undefined,
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Order created");
      qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, "Create failed")),
  });
  const pending = create.isPending;

  return (
    <Dialog
      wide
      icon={<FileTextIcon size={20} />}
      kicker="Purchasing Â· New order"
      title="New purchase order"
      intro="Saved as a draft. Nothing is posted to stock or the ledger until the order is received."
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <p className="text-xs text-ink-4">
            {ready ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircleIcon size={13} /> Ready to save
              </span>
            ) : !supplierId ? (
              "Still needed: supplier"
            ) : (
              `${incomplete} item${incomplete === 1 ? "" : "s"} incomplete`
            )}
          </p>
          <div className="flex justify-end gap-2">
            <DialogClose onClose={onClose} pending={pending} />
            <button type="button" onClick={() => create.mutate()} disabled={pending || !ready} className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm">
              {pending ? (
                <>
                  <Spinner /> Savingâ€¦
                </>
              ) : (
                <>
                  Save draft <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                </>
              )}
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Supplier</Label>
            <Select
              ariaLabel="Supplier"
              value={supplierId}
              onChange={setSupplierId}
              loading={suppliers.isLoading}
              searchable
              icon={<TruckIcon size={13} />}
              placeholder={suppliers.isLoading ? "Loading suppliersâ€¦" : "Choose supplier"}
              options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name, hint: s.code }))}
            />
          </div>
          <div>
            <Label htmlFor="po-notes" extra={<span className="text-[11px] font-normal text-ink-5">Optional</span>}>
              Notes
            </Label>
            <input id="po-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery terms, referencesâ€¦" className={inputCls} />
          </div>
        </div>

        <PurchaseItemsEditor items={items} onChange={setItems} costLabel="Est. cost" />

        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-ink/[0.06] ring-1 ring-ink/[0.06]">
          {[
            { k: "Items", v: String(items.length) },
            { k: "Gross weight", v: `${grossTotal.toLocaleString("en-US", { maximumFractionDigits: 3 })} g` },
            { k: "Est. cost", v: `LKR ${lkr(costTotal)}`, gold: true },
          ].map((t) => (
            <div key={t.k} className={cn("px-4 py-3", t.gold ? "bg-void text-paper" : "bg-paper")}>
              <div className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", t.gold ? "text-paper/45" : "text-ink-5")}>{t.k}</div>
              <div className={cn("g-metric mt-0.5 truncate text-base", t.gold ? "text-gold-light" : "text-ink")}>{t.v}</div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Receive ---------- */

function ReceiveDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [pending, setPending] = useState(false);
  const banks = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => api<{ id: string; name: string; account_code: string; is_active: number }[]>("/api/v1/bank-accounts"),
  });

  const chargesOk = charges === "" || num(charges) >= 0;
  const paidOk = paid === "" || num(paid) >= 0;
  const paying = paid !== "" && num(paid) > 0;
  const ready = chargesOk && paidOk && (!paying || !!bankAccountId);

  async function receive() {
    setPending(true);
    try {
      const body: Record<string, unknown> = {};
      if (charges !== "") body.chargesLkr = num(charges);
      if (paid !== "") {
        body.paidLkr = num(paid);
        body.paidBankAccountId = bankAccountId;
      }
      const res = await api<{ number: string }>(`/api/v1/purchases/orders/${order.id}/receive`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(`Received as ${res.number}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    } catch (e) {
      toast.error(errMsg(e, "Receive failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      icon={<PackagePlusIcon size={20} />}
      kicker="Purchasing Â· Receive"
      title={`Receive ${order.number}`}
      intro={
        <>
          <span className="font-medium text-paper/80">{order.supplier_name}</span> Â· {order.items} item{order.items === 1 ? "" : "s"}. Creates
          products, stock, ledger and journal entries atomically.
        </>
      }
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <p className="text-xs text-ink-4">
            {paying && !bankAccountId ? "Choose the account the payment leaves from" : "Posting cannot be undone from here"}
          </p>
          <div className="flex justify-end gap-2">
            <DialogClose onClose={onClose} pending={pending} />
            <button type="button" onClick={receive} disabled={pending || !ready} className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm">
              {pending ? (
                <>
                  <Spinner /> Receivingâ€¦
                </>
              ) : (
                <>
                  Receive <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                </>
              )}
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-4 p-6">
        <div>
          <Label extra={<span className="text-[11px] font-normal text-ink-5">Optional</span>}>Additional charges</Label>
          <UnitInput value={charges} onChange={setCharges} unit="LKR" placeholder="0.00" invalid={!chargesOk} icon={<BanknoteIcon size={14} />} />
        </div>
        <div className="rounded-2xl bg-bone/50 p-4 ring-1 ring-ink/[0.06]">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">Pay on receipt</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Paid now</Label>
              <UnitInput value={paid} onChange={setPaid} unit="LKR" placeholder="0.00" invalid={!paidOk} />
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
          <p className="mt-2.5 text-[11px] text-ink-4">Leave blank to post the full amount as payable to the supplier.</p>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Cancel ---------- */

function CancelDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function cancel() {
    setPending(true);
    try {
      await api(`/api/v1/purchases/orders/${order.id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.success("Order cancelled");
      qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    } catch (e) {
      toast.error(errMsg(e, "Cancel failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      danger
      icon={<CircleSlashIcon size={20} />}
      kicker="Purchasing Â· Cancel"
      title={`Cancel ${order.number}`}
      intro={`${order.supplier_name} Â· ${order.items} item${order.items === 1 ? "" : "s"}. A cancelled order can no longer be received.`}
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <p className="text-xs text-ink-4">A reason is required for the audit trail.</p>
          <div className="flex justify-end gap-2">
            <DialogClose onClose={onClose} pending={pending} />
            <button
              type="button"
              onClick={cancel}
              disabled={pending || !reason.trim()}
              className="g-btn h-11 rounded-xl bg-rose-600 px-5 text-sm text-paper hover:bg-rose-700 disabled:opacity-50"
            >
              {pending ? (
                <>
                  <Spinner /> Cancellingâ€¦
                </>
              ) : (
                "Cancel order"
              )}
            </button>
          </div>
        </>
      }
    >
      <div className="p-6">
        <Label htmlFor="po-cancel-reason" extra={<span className="text-[11px] font-normal text-ink-5">{reason.length}/500</span>}>
          Reason
        </Label>
        <textarea
          id="po-cancel-reason"
          autoFocus
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Supplier could not deliver"
          className={cn(inputCls, "h-auto min-h-[5.5rem] resize-y py-3 leading-relaxed")}
        />
      </div>
    </Dialog>
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
        Showing <span className="g-metric font-medium text-ink">{from}â€“{to}</span> of{" "}
        <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> orders
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
