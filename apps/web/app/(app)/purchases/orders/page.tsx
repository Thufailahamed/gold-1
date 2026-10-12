"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { type ItemDraft } from "@/components/purchase-items";
import { Dialog, DialogClose, Label, PurchaseItemsEditor, Spinner, UnitInput, inputCls, itemMissing, newItem, num } from "@/components/purchase-form";
import { Page, Skeleton } from "@/components/ui";
import { Card, CardHead, FilterPills, GoldHero, HeroBadge, ORDER_META, ORDER_STATUSES as PO_STATUSES, PoChip, RowsSkeleton, ago, heroGold, inputCls as kitInput, th, thead, tr } from "../kit";

const ORDER_STATUSES: readonly string[] = PO_STATUSES;
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
  // One count per status for the pills and the header — same cache as the overview.
  const counts = useQueries({
    queries: ORDER_STATUSES.map((s) => ({
      queryKey: ["pur-dash", "order-state", s],
      queryFn: () => api<{ rows: Order[]; total: number }>(`/api/v1/purchases/orders?status=${s}&limit=${s === "DRAFT" || s === "SENT" ? 6 : 1}`),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const countOf = (s: string) => counts[ORDER_STATUSES.indexOf(s)]?.data?.total;
  const countsLoading = counts.some((c) => c.isLoading);
  const allCount = countsLoading ? undefined : ORDER_STATUSES.reduce((n, s) => n + (countOf(s) ?? 0), 0);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const itemCount = rows.reduce((n, r) => n + r.items, 0);
  const filtered = Boolean(search || fStatus);
  const sent = countOf("SENT") ?? 0;

  const setFilter = (s: string) => {
    setFStatus(s);
    setPage(1);
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={FileTextIcon}
        title="Purchase"
        accent="orders"
        badge={sent > 0 ? <HeroBadge tone="warn">{sent} with supplier</HeroBadge> : <HeroBadge>Received in one step</HeroBadge>}
        sub="Receiving a draft creates products, stock movements and journal entries atomically"
        actions={
          canCreate ? (
            <button type="button" onClick={() => setDialog(true)} className={heroGold}>
              <PlusIcon size={13} />
              New order
            </button>
          ) : null
        }
        stats={[
          { label: "All orders", value: allCount, accent: true, loading: countsLoading, sub: "On file" },
          { label: "Open", value: countsLoading ? undefined : (countOf("DRAFT") ?? 0) + sent, loading: countsLoading, sub: "Draft or sent" },
          ...ORDER_STATUSES.map((s) => ({
            label: ORDER_META[s]!.label,
            value: countOf(s),
            loading: countsLoading,
            tone: s === "SENT" && sent ? ("warn" as const) : s === "RECEIVED" ? ("good" as const) : undefined,
            sub: ORDER_META[s]!.hint,
          })),
        ]}
      />

      <Card>
        <CardHead
          icon={FileTextIcon}
          title="Order book"
          sub={`${total.toLocaleString("en-US")} ${filtered ? "matching" : "on file"} · ${itemCount} item line${itemCount === 1 ? "" : "s"} on this page`}
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
                  aria-label="Search orders"
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
              ...ORDER_STATUSES.map((s) => ({ key: s, label: ORDER_META[s]!.label, count: countOf(s), dot: ORDER_META[s]!.dot })),
            ]}
          />
        </div>

        {list.isLoading ? (
          <RowsSkeleton rows={8} />
        ) : list.isError ? (
          <Empty
            icon={<AlertCircleIcon size={22} />}
            title="Couldn't load orders"
            body="Check the API connection, then retry."
            action={
              <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-9 rounded-lg px-3 text-sm">
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty
            icon={<FileTextIcon size={22} />}
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
                  className="g-btn g-btn-secondary h-9 rounded-lg px-3 text-sm"
                >
                  Clear filters
                </button>
              ) : canCreate ? (
                <button type="button" onClick={() => setDialog(true)} className="g-btn g-btn-primary h-9 rounded-lg px-3 text-sm">
                  <PlusIcon size={14} /> New order
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Order</th>
                  <th className={th}>Supplier</th>
                  <th className={cn(th, "text-right")}>Items</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                  <th className={cn(th, "pr-4 text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const isOpen = o.status === "DRAFT" || o.status === "SENT";
                  const cancelled = o.status === "CANCELLED";
                  return (
                    <tr key={o.id} className={cn(tr, "group", cancelled && "opacity-60")}>
                      <td className="py-1.5 pl-4 pr-2">
                        <span className={cn("g-metric font-semibold text-ink", cancelled && "line-through")}>{o.number}</span>
                      </td>
                      <td className="px-2">
                        <span className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[9px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {initials(o.supplier_name || "?")}
                          </span>
                          <span className="max-w-[16rem] truncate font-medium text-ink-2">{o.supplier_name}</span>
                        </span>
                      </td>
                      <td className="g-metric px-2 text-right text-ink">{o.items}</td>
                      <td className="px-2">
                        <PoChip status={o.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 text-ink-4" title={day(o.created_at)}>
                        {ago(o.created_at)}
                      </td>
                      <td className="py-1.5 pl-2 pr-4">
                        <span className="flex items-center justify-end gap-1">
                          {isOpen && canCreate ? (
                            <button
                              type="button"
                              onClick={() => setReceiving(o)}
                              className="inline-flex h-7 items-center gap-1 rounded-md bg-void px-2.5 text-[11.5px] font-semibold text-paper transition hover:text-gold-light"
                            >
                              <PackagePlusIcon size={12} className="text-gold-light" />
                              Receive
                            </button>
                          ) : null}
                          {isOpen && canCancel ? (
                            <button
                              type="button"
                              onClick={() => setCancelling(o)}
                              aria-label={`Cancel ${o.number}`}
                              title="Cancel order"
                              className="flex size-7 items-center justify-center rounded-md text-ink-4 ring-1 ring-inset ring-ink/10 transition hover:bg-rose-50 hover:text-rose-700 hover:ring-rose-300"
                            >
                              <CircleSlashIcon size={13} />
                            </button>
                          ) : null}
                          {!isOpen ? <span className="text-[11px] text-ink-6">—</span> : null}
                        </span>
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
      kicker="Purchasing · New order"
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
                  <Spinner /> Saving…
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
              placeholder={suppliers.isLoading ? "Loading suppliers…" : "Choose supplier"}
              options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name, hint: s.code }))}
            />
          </div>
          <div>
            <Label htmlFor="po-notes" extra={<span className="text-[11px] font-normal text-ink-5">Optional</span>}>
              Notes
            </Label>
            <input id="po-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery terms, references…" className={inputCls} />
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
      kicker="Purchasing · Receive"
      title={`Receive ${order.number}`}
      intro={
        <>
          <span className="font-medium text-paper/80">{order.supplier_name}</span> · {order.items} item{order.items === 1 ? "" : "s"}. Creates
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
                  <Spinner /> Receiving…
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
      kicker="Purchasing · Cancel"
      title={`Cancel ${order.number}`}
      intro={`${order.supplier_name} · ${order.items} item${order.items === 1 ? "" : "s"}. A cancelled order can no longer be received.`}
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
                  <Spinner /> Cancelling…
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
        Showing <span className="g-metric font-medium text-ink">{from}–{to}</span> of{" "}
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
