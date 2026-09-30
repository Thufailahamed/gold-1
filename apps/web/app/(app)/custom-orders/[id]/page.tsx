"use client";

import { use, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission, lkrToCents, mgToG, PERMISSIONS, salesTaxCents } from "@goldos/shared";
import { api, PendingApprovalError, type MeData } from "@/lib/api";
import { lkr, toCents, type BankAccount } from "@/lib/accounts";
import { LineageChain, type LineageEdge, type LineageNode } from "@/components/lineage-chain";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  DetailList,
  Pill,
  StatusPill,
  Modal,
  Callout,
  EmptyBlock,
  Skeleton,
  Field,
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
} from "@/components/ui";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CheckIcon,
  CircleSlashIcon,
  CoinsIcon,
  FileTextIcon,
  GemIcon,
  HammerIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
  TruckIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

type CustomStatus = "QUOTE" | "ADVANCED" | "IN_PRODUCTION" | "QC_PASSED" | "READY" | "DELIVERED" | "CANCELLED";
type GoldKind = "CUSTOMER_OLDGOLD" | "SHOP_LOT";

type Detail = {
  order: {
    id: string;
    number: string;
    customer_id: string;
    branch_id: string;
    design: string;
    description: string | null;
    gold_req_mg: number;
    gold_source: "CUSTOMER" | "SHOP" | "MIXED";
    quote_cents: number;
    advance_cents: number;
    manufacturing_order_id: string | null;
    sale_id: string | null;
    status: CustomStatus;
    created_at: number;
  };
  gold: { kind: GoldKind; ref_id: string; fine_mg: number }[];
};

type Lineage = {
  order: { id: string; number: string; status: string };
  gold: { kind: GoldKind; ref_id: string }[];
  manufacturing: { id: string; number: string; status: string } | null;
  sale: { id: string; number: string; total_cents: number } | null;
};

type Customer = { id: string; name: string; code: string; phone: string | null };
type Branch = { id: string; name: string };
type OldGoldItem = { id: string; number: string; description: string; status: string; fine_mg: number | null; branch_id: string };
type MfgOrderRow = { id: string; number: string; design: string; status: string };
type MfgDetail = {
  order: { id: string; number: string; status: string };
  outputs: { id: string; product_id: string | null; name: string; net_mg: number }[];
};
type Batch = { id: string; number: string };
type BatchDetail = { outputs: { lot_number: string; fine_mg: number; permille: number; output_type: string }[] };

const STATUS_LABEL: Record<CustomStatus, string> = {
  QUOTE: "Quote",
  ADVANCED: "Advance taken",
  IN_PRODUCTION: "In production",
  QC_PASSED: "QC passed",
  READY: "Ready to deliver",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const SOURCE_LABEL: Record<Detail["order"]["gold_source"], string> = {
  CUSTOMER: "Customer gold",
  SHOP: "Shop gold",
  MIXED: "Mixed (customer + shop)",
};

const KIND_LABEL: Record<GoldKind, string> = {
  CUSTOMER_OLDGOLD: "Customer old gold",
  SHOP_LOT: "Shop melt lot",
};

const STEPS = ["Quote", "Advance", "Production", "QC", "Ready", "Delivered"];

/** Index of the step in progress; steps before it are done. */
function stepOf(status: CustomStatus): number {
  switch (status) {
    case "QUOTE":
      return 0;
    case "ADVANCED":
      return 1;
    case "IN_PRODUCTION":
      return 2;
    case "QC_PASSED":
      return 3;
    case "READY":
      return 4;
    case "DELIVERED":
      return STEPS.length;
    default:
      return -1;
  }
}

const PRE_PRODUCTION: ReadonlyArray<CustomStatus> = ["QUOTE", "ADVANCED"];
const IN_WORKSHOP: ReadonlyArray<CustomStatus> = ["IN_PRODUCTION", "QC_PASSED"];

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** SHOP_LOT refs are "batchId::lotNumber" (see sourceGold in the API). */
function splitLotRef(ref: string): { batchId: string; lotNumber: string } | null {
  const [batchId, lotNumber, ...rest] = ref.split("::");
  return batchId && lotNumber && rest.length === 0 ? { batchId, lotNumber } : null;
}

/** Shared error handling: a 202 PENDING names its approval; everything else toasts. */
function toastError(e: unknown, fallback: string, onPending?: (err: PendingApprovalError) => void) {
  if (e instanceof PendingApprovalError) {
    if (onPending) onPending(e);
    toast.message("Sent for approval", {
      description: "Once it is approved in the Approval Center, repeat the action.",
    });
    return;
  }
  toast.error(errMsg(e, fallback));
}

export default function CustomOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "advance" | "source" | "produce" | "deliver" | "cancel">(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const detail = useQuery({
    queryKey: ["custom-order", id],
    queryFn: () => api<Detail>(`/api/v1/custom-orders/${id}`),
  });
  const lineage = useQuery({
    queryKey: ["custom-order-lineage", id],
    queryFn: () => api<Lineage>(`/api/v1/custom-orders/${id}/lineage`),
  });

  const o = detail.data?.order;
  const perms = me.data?.permissions ?? [];
  const canOldGold = hasPermission(perms, PERMISSIONS.OLDGOLD_VIEW);

  const customer = useQuery({
    queryKey: ["customer", o?.customer_id],
    queryFn: () => api<Customer>(`/api/v1/customers/${o?.customer_id}`),
    enabled: !!o,
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100"),
  });
  // Old-gold numbers for the earmark table, the lineage chips and the picker.
  const oldGold = useQuery({
    queryKey: ["co-oldgold", o?.customer_id],
    queryFn: () =>
      api<{ rows: OldGoldItem[]; total: number }>(`/api/v1/oldgold/items?customerId=${o?.customer_id}&limit=100`),
    enabled: !!o && canOldGold,
  });
  const mo = useQuery({
    queryKey: ["mfg-order", o?.manufacturing_order_id],
    queryFn: () => api<MfgDetail>(`/api/v1/manufacturing/orders/${o?.manufacturing_order_id}`),
    enabled: !!o?.manufacturing_order_id,
  });
  const moLineage = useQuery({
    queryKey: ["mfg-lineage", o?.manufacturing_order_id],
    queryFn: () =>
      api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(
        `/api/v1/gold/lineage?refEntity=manufacturing_order&refId=${o?.manufacturing_order_id}`
      ),
    enabled: !!o?.manufacturing_order_id,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["custom-order", id] });
    qc.invalidateQueries({ queryKey: ["custom-order-lineage", id] });
    qc.invalidateQueries({ queryKey: ["custom-orders"] });
    qc.invalidateQueries({ queryKey: ["mfg-order"] });
    qc.invalidateQueries({ queryKey: ["mfg-orders"] });
    qc.invalidateQueries({ queryKey: ["mfg-lineage"] });
    qc.invalidateQueries({ queryKey: ["co-oldgold"] });
  }

  function done() {
    setDialog(null);
    refresh();
  }

  const sync = useMutation({
    mutationFn: () => api<{ status: CustomStatus }>(`/api/v1/custom-orders/${id}/sync`, { method: "POST" }),
    onSuccess: (d) => {
      if (d.status === o?.status) toast.info(`No change — still ${STATUS_LABEL[d.status] ?? d.status}`);
      else toast.success(`Now ${STATUS_LABEL[d.status] ?? d.status}`);
      refresh();
    },
    onError: (e) => toastError(e, "Sync failed"),
  });

  const ogById = useMemo(() => new Map((oldGold.data?.rows ?? []).map((r) => [r.id, r])), [oldGold.data]);

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64" />
      </Page>
    );
  }
  if (detail.isError || !detail.data || !o) {
    return (
      <Page>
        <Callout tone="danger" title="Custom order could not be loaded">
          {errMsg(detail.error, "This custom order does not exist or you cannot view it.")}{" "}
          <Link href="/custom-orders" className="font-medium underline">
            Back to custom orders
          </Link>
        </Callout>
      </Page>
    );
  }

  const gold = detail.data.gold;
  const earmarkedMg = gold.reduce((n, g) => n + g.fine_mg, 0);
  const remainingCents = Math.max(0, o.quote_cents - o.advance_cents);
  const branchName = branches.data?.rows.find((b) => b.id === o.branch_id)?.name ?? "—";
  const customerLabel = customer.data ? `${customer.data.name} (${customer.data.code})` : "…";

  const pre = PRE_PRODUCTION.includes(o.status);
  const workshop = IN_WORKSHOP.includes(o.status);
  // Each button mirrors the permission its route requires.
  const showAdvance = pre && remainingCents > 0 && hasPermission(perms, PERMISSIONS.ACCOUNTS_MANAGE);
  const showSource = pre && hasPermission(perms, PERMISSIONS.MFG_EDIT);
  const showProduce = pre && hasPermission(perms, PERMISSIONS.MFG_EDIT);
  const showSync = workshop && !!o.manufacturing_order_id && hasPermission(perms, PERMISSIONS.MFG_VIEW);
  const showDeliver = o.status === "READY" && hasPermission(perms, PERMISSIONS.SALES_CREATE);
  const showCancel = (pre || workshop) && hasPermission(perms, PERMISSIONS.MFG_EDIT);

  const step = stepOf(o.status);
  const refLabel = (g: { kind: GoldKind; ref_id: string }) =>
    g.kind === "SHOP_LOT"
      ? splitLotRef(g.ref_id)?.lotNumber ?? g.ref_id
      : ogById.get(g.ref_id)?.number ?? `${g.ref_id.slice(0, 8)}…`;
  const refUrl = (g: { kind: GoldKind; ref_id: string }) =>
    g.kind === "SHOP_LOT"
      ? (() => {
          const p = splitLotRef(g.ref_id);
          return p ? `/gold/melting/${p.batchId}` : null;
        })()
      : `/old-gold/items/${g.ref_id}`;

  // Order lineage: earmarked gold → this order → production → sale.
  const chain = (() => {
    const l = lineage.data;
    if (!l) return null;
    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    const orderKey = `co:${l.order.id}`;
    for (const g of l.gold) {
      const key = `${g.kind}:${g.ref_id}`;
      nodes.push({ key, kind: g.kind === "SHOP_LOT" ? "melting_batch" : "old_gold", label: refLabel(g), url: refUrl(g) });
      edges.push({ from: key, to: orderKey });
    }
    nodes.push({ key: orderKey, kind: "custom_order", label: l.order.number, url: null });
    let tail = orderKey;
    if (l.manufacturing) {
      const key = `mo:${l.manufacturing.id}`;
      nodes.push({ key, kind: "manufacturing_order", label: l.manufacturing.number, url: `/manufacturing/orders/${l.manufacturing.id}` });
      edges.push({ from: tail, to: key });
      tail = key;
    }
    if (l.sale) {
      const key = `sale:${l.sale.id}`;
      nodes.push({ key, kind: "sale_invoice", label: l.sale.number, url: `/sales/invoices/${l.sale.id}` });
      edges.push({ from: tail, to: key });
    }
    return { nodes, edges };
  })();

  return (
    <Page>
      <Hero
        back={{ href: "/custom-orders", label: "Custom orders" }}
        kicker="Custom order"
        title={o.number}
        description={`${o.design}${o.description ? ` — ${o.description}` : ""}`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">
              {STATUS_LABEL[o.status] ?? o.status}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {customerLabel}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {branchName}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {new Date(o.created_at).toLocaleString()}
            </Pill>
          </>
        }
        stats={[
          { label: "Quote", value: `${lkr(o.quote_cents)} LKR` },
          { label: "Advances", value: `${lkr(o.advance_cents)} LKR` },
          { label: "Balance on quote", value: `${lkr(remainingCents)} LKR` },
          { label: "Gold earmarked", value: `${grams(earmarkedMg)} / ${grams(o.gold_req_mg)} g` },
        ]}
        actions={
          <>
            {showAdvance ? (
              <button type="button" onClick={() => setDialog("advance")} className={heroBtnPrimary}>
                <BanknoteIcon size={15} /> Take advance
              </button>
            ) : null}
            {showSource ? (
              <button type="button" onClick={() => setDialog("source")} className={heroBtnGhost}>
                <GemIcon size={15} /> Earmark gold
              </button>
            ) : null}
            {showProduce ? (
              <button type="button" onClick={() => setDialog("produce")} className={heroBtnGhost}>
                <HammerIcon size={15} /> Start production
              </button>
            ) : null}
            {showSync ? (
              <button
                type="button"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                className={cn(heroBtnPrimary, "disabled:opacity-50")}
              >
                <RefreshCwIcon size={15} /> {sync.isPending ? "Syncing…" : "Sync with production"}
              </button>
            ) : null}
            {showDeliver ? (
              <button type="button" onClick={() => setDialog("deliver")} className={heroBtnPrimary}>
                <TruckIcon size={15} /> Deliver
              </button>
            ) : null}
            {showCancel ? (
              <button type="button" onClick={() => setDialog("cancel")} className={`${heroBtnGhost} !text-rose-300`}>
                <CircleSlashIcon size={15} /> Cancel order
              </button>
            ) : null}
          </>
        }
      />

      {o.status === "CANCELLED" ? (
        <Callout tone="danger" title="Order cancelled">
          Cash advances were refunded through a reversing entry. The order and its earmarks are kept for the record.
        </Callout>
      ) : (
        <ol className="flex flex-wrap items-center gap-2" aria-label="Custom order progress">
          {STEPS.map((s, i) => {
            const isDone = i < step;
            const current = i === step;
            return (
              <li key={s} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                    isDone
                      ? "bg-ink text-paper"
                      : current
                        ? "bg-gold-soft text-ink shadow-[inset_0_0_0_1px_rgba(168,134,27,0.3)]"
                        : "bg-ink/[0.05] text-ink-4"
                  )}
                >
                  {isDone ? <CheckIcon size={12} className="text-gold" aria-hidden /> : null}
                  {s}
                  <span className="sr-only">{isDone ? " (done)" : current ? " (in progress)" : " (not started)"}</span>
                </span>
                {i < STEPS.length - 1 ? <ArrowRightIcon size={12} className="text-ink-5" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      )}

      {workshop && o.manufacturing_order_id ? (
        <Callout tone="info" title="Production runs on the manufacturing order">
          Add materials (earmarked lots only), produce, QC and finish on the linked manufacturing order, then sync
          here to move this order along.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Order details" icon={<FileTextIcon size={17} />}>
          <DetailList
            columns={2}
            items={[
              { label: "Customer", value: customerLabel },
              { label: "Phone", value: customer.data?.phone ?? "-" },
              { label: "Branch", value: branchName },
              { label: "Gold source", value: SOURCE_LABEL[o.gold_source] ?? o.gold_source },
              { label: "Gold required", value: `${grams(o.gold_req_mg)} g` },
              { label: "Design", value: o.design },
              { label: "Description", value: o.description || "-" },
              { label: "Status", value: <StatusPill status={o.status} label={STATUS_LABEL[o.status] ?? o.status} /> },
            ]}
          />
        </Panel>

        <Panel
          title="Money"
          icon={<CoinsIcon size={17} />}
          description="Advances book to customer payables and are applied when the piece is delivered."
        >
          <DetailList
            columns={2}
            items={[
              { label: "Quote (net of tax)", value: <span className="num-tabular">{lkr(o.quote_cents)} LKR</span> },
              { label: "Advances received", value: <span className="num-tabular">{lkr(o.advance_cents)} LKR</span> },
              { label: "Left to collect on quote", value: <span className="num-tabular">{lkr(remainingCents)} LKR</span> },
              {
                label: "Sale",
                value: lineage.data?.sale ? (
                  <Link href={`/sales/invoices/${lineage.data.sale.id}`} className="font-medium text-ink hover:text-gold-700">
                    {lineage.data.sale.number} · {lkr(lineage.data.sale.total_cents)} LKR
                  </Link>
                ) : (
                  "Not delivered yet"
                ),
              },
            ]}
          />
          {o.advance_cents > 0 && pre ? (
            <p className="mt-4 border-t border-ink/10 pt-3 text-xs text-ink-4">
              Only cash advances refund automatically on cancel; card or bank advances need a manual reversal first.
            </p>
          ) : null}
        </Panel>
      </div>

      <TableCard
        title="Earmarked gold"
        icon={<GemIcon size={17} />}
        description={`${grams(earmarkedMg)} g fine of ${grams(o.gold_req_mg)} g required`}
        actions={
          showSource ? (
            <button type="button" onClick={() => setDialog("source")} className="g-btn g-btn-secondary h-8 px-3 text-xs">
              <PlusIcon size={13} /> Earmark
            </button>
          ) : null
        }
      >
        {gold.length === 0 ? (
          <EmptyBlock
            icon={<GemIcon size={22} />}
            title="No gold earmarked"
            description={
              pre
                ? "Link a purchased old-gold item of this customer or an approved melt lot of this branch."
                : "No gold was earmarked for this order."
            }
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Reference</th>
                <th className="!text-right">Fine g</th>
              </tr>
            </thead>
            <tbody>
              {gold.map((g) => {
                const url = refUrl(g);
                return (
                  <tr key={`${g.kind}:${g.ref_id}`}>
                    <td>
                      <Pill tone={g.kind === "SHOP_LOT" ? "info" : "brand"}>{KIND_LABEL[g.kind] ?? g.kind}</Pill>
                    </td>
                    <td className="g-metric text-xs">
                      {url ? (
                        <Link href={url} className="font-medium text-ink hover:text-gold-700">
                          {refLabel(g)}
                        </Link>
                      ) : (
                        refLabel(g)
                      )}
                    </td>
                    <td className="!text-right num-tabular">{grams(g.fine_mg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <Panel
        title="Production"
        icon={<HammerIcon size={17} />}
        description="The manufacturing order that makes this piece."
      >
        {!o.manufacturing_order_id ? (
          <EmptyBlock
            icon={<HammerIcon size={22} />}
            title="Production not started"
            description={pre ? "Start production to create or link a customer manufacturing order." : "No manufacturing order was linked."}
          />
        ) : mo.isLoading ? (
          <Skeleton className="h-14" />
        ) : mo.isError || !mo.data ? (
          <Callout tone="danger" title="Could not load the manufacturing order">
            {errMsg(mo.error, "Retry in a moment.")}
          </Callout>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href={`/manufacturing/orders/${mo.data.order.id}`}
                className="inline-flex items-center gap-1.5 g-metric font-medium text-ink hover:text-gold-700"
              >
                {mo.data.order.number} <ArrowRightIcon size={12} />
              </Link>
              <StatusPill status={mo.data.order.status} />
            </div>
            {mo.data.outputs.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {mo.data.outputs.map((out) => (
                  <li key={out.id} className="flex items-center justify-between gap-3">
                    {out.product_id ? (
                      <Link href={`/products/${out.product_id}`} className="font-medium text-ink hover:text-gold-700">
                        {out.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{out.name}</span>
                    )}
                    <span className="num-tabular text-ink-3">{grams(out.net_mg)} g net</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-4">No outputs produced yet.</p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Lineage" description="Earmarked gold → custom order → production → sale">
        {lineage.isLoading ? (
          <Skeleton className="h-10" />
        ) : lineage.isError || !chain ? (
          <Callout tone="danger" title="Lineage failed">
            {errMsg(lineage.error, "Could not load the lineage.")}
          </Callout>
        ) : (
          <LineageChain nodes={chain.nodes} edges={chain.edges} />
        )}
        {o.manufacturing_order_id ? (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Production trace</div>
            {moLineage.data ? (
              <LineageChain nodes={moLineage.data.nodes} edges={moLineage.data.edges} />
            ) : moLineage.isError ? (
              <p className="text-xs text-ink-4">{errMsg(moLineage.error, "Trace unavailable.")}</p>
            ) : (
              <Skeleton className="h-10" />
            )}
          </div>
        ) : null}
      </Panel>

      {dialog === "advance" ? (
        <AdvanceDialog orderId={id} remainingCents={remainingCents} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog === "source" ? (
        <SourceDialog
          orderId={id}
          branchId={o.branch_id}
          goldSource={o.gold_source}
          canOldGold={canOldGold}
          canGold={hasPermission(perms, PERMISSIONS.GOLD_VIEW)}
          oldGold={oldGold.data?.rows ?? []}
          earmarked={new Set(gold.map((g) => `${g.kind}:${g.ref_id}`))}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog === "produce" ? (
        <StartProductionDialog
          orderId={id}
          customerId={o.customer_id}
          branchId={o.branch_id}
          earmarked={gold.length}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog === "deliver" ? (
        <DeliverDialog
          orderId={id}
          quoteCents={o.quote_cents}
          advanceCents={o.advance_cents}
          pieces={(mo.data?.outputs ?? []).filter((x) => x.product_id).length}
          piecesLoading={mo.isLoading}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog === "cancel" ? (
        <CancelDialog
          orderId={id}
          needsApprover={workshop}
          advanceCents={o.advance_cents}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- Advance */

function AdvanceDialog({
  orderId,
  remainingCents,
  onClose,
  onDone,
}: {
  orderId: string;
  remainingCents: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "bank">("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const banks = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts"),
    enabled: method === "bank",
  });
  const cents = toCents(amount);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= remainingCents;

  const advance = useMutation({
    mutationFn: () =>
      api<{ advanceCents: number }>(`/api/v1/custom-orders/${orderId}/advance`, {
        method: "POST",
        body: JSON.stringify({
          amountLkr: cents / 100,
          method,
          bankAccountId: method === "bank" && bankAccountId ? bankAccountId : undefined,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Advance posted — ${lkr(d.advanceCents)} LKR received in total`);
      onDone();
    },
    onError: (e) => toastError(e, "Advance failed"),
  });

  return (
    <Modal
      kicker="Custom order"
      title="Take advance"
      onClose={onClose}
      onSubmit={() => advance.mutate()}
      pending={advance.isPending}
      submitDisabled={!valid}
      submitLabel="Post advance"
    >
      <Field
        label="Amount (LKR)"
        htmlFor="co-adv-amount"
        hint={`Up to ${lkr(remainingCents)} LKR — advances cannot exceed the quote.`}
        error={
          amount && !Number.isFinite(cents)
            ? "Enter an amount with at most 2 decimals."
            : Number.isFinite(cents) && cents > remainingCents
              ? `Only ${lkr(remainingCents)} LKR is left on the quote.`
              : undefined
        }
      >
        <input
          id="co-adv-amount"
          autoFocus
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`w-full num-tabular ${controlClass}`}
        />
      </Field>
      <div className="flex gap-2" role="radiogroup" aria-label="Method">
        {(["cash", "card", "bank"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={`g-btn h-9 flex-1 px-3.5 text-xs capitalize ${method === m ? "g-btn-primary" : "g-btn-secondary"}`}
          >
            {m}
          </button>
        ))}
      </div>
      {method === "bank" ? (
        <Field label="Bank account" htmlFor="co-adv-bank" hint="Leave blank to post to the default bank ledger.">
          <select
            id="co-adv-bank"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">Default bank account</option>
            {(banks.data ?? [])
              .filter((b) => b.is_active)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.bank_name ? ` · ${b.bank_name}` : ""}
                </option>
              ))}
          </select>
        </Field>
      ) : null}
      {method !== "cash" ? (
        <Callout tone="warning">Card and bank advances are not refunded automatically if the order is cancelled.</Callout>
      ) : null}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Earmark */

function SourceDialog({
  orderId,
  branchId,
  goldSource,
  canOldGold,
  canGold,
  oldGold,
  earmarked,
  onClose,
  onDone,
}: {
  orderId: string;
  branchId: string;
  goldSource: Detail["order"]["gold_source"];
  canOldGold: boolean;
  canGold: boolean;
  oldGold: OldGoldItem[];
  earmarked: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<GoldKind>(goldSource === "SHOP" ? "SHOP_LOT" : "CUSTOMER_OLDGOLD");
  const [ogId, setOgId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  // Fallback when the picker has nothing to offer (no permission or no match).
  const [manualRef, setManualRef] = useState("");

  const batches = useQuery({
    queryKey: ["co-approved-batches", branchId],
    queryFn: () =>
      api<{ rows: Batch[]; total: number }>(`/api/v1/melting/batches?status=APPROVED&branchId=${branchId}&limit=50`),
    enabled: kind === "SHOP_LOT" && canGold,
  });
  const batch = useQuery({
    queryKey: ["melt-batch", batchId],
    queryFn: () => api<BatchDetail>(`/api/v1/melting/batches/${batchId}`),
    enabled: kind === "SHOP_LOT" && !!batchId,
  });

  // The API accepts PURCHASED or AVAILABLE items of this customer only.
  const ogChoices = oldGold.filter(
    (r) => (r.status === "PURCHASED" || r.status === "AVAILABLE") && !earmarked.has(`CUSTOMER_OLDGOLD:${r.id}`)
  );
  const lotChoices = (batch.data?.outputs ?? []).filter((l) => !earmarked.has(`SHOP_LOT:${batchId}::${l.lot_number}`));

  const picked = kind === "CUSTOMER_OLDGOLD" ? ogId : batchId && lotNumber ? `${batchId}::${lotNumber}` : "";
  const refId = manualRef.trim() || picked;

  const source = useMutation({
    mutationFn: () =>
      api(`/api/v1/custom-orders/${orderId}/source`, {
        method: "POST",
        body: JSON.stringify({ kind, refId }),
      }),
    onSuccess: () => {
      toast.success("Gold earmarked");
      onDone();
    },
    onError: (e) => toastError(e, "Earmark failed"),
  });

  return (
    <Modal
      wide
      kicker="Custom order"
      title="Earmark gold"
      onClose={onClose}
      onSubmit={() => source.mutate()}
      pending={source.isPending}
      submitDisabled={!refId}
      submitLabel="Earmark"
    >
      <p className="text-sm text-ink-3">
        Earmarks are links, not movements: gold still moves through the normal purchase, melt and manufacture postings.
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="Gold source">
        {(["CUSTOMER_OLDGOLD", "SHOP_LOT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setManualRef("");
            }}
            className={`g-btn h-9 flex-1 px-3.5 text-xs ${kind === k ? "g-btn-primary" : "g-btn-secondary"}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {kind === "CUSTOMER_OLDGOLD" ? (
        canOldGold ? (
          <Field
            label="Purchased old-gold item"
            htmlFor="co-src-og"
            hint={
              ogChoices.length === 0
                ? "No purchased, un-earmarked item for this customer. Buy it through old gold first."
                : "Only items already bought from this customer can be earmarked."
            }
          >
            <select id="co-src-og" value={ogId} onChange={(e) => setOgId(e.target.value)} className={`w-full ${controlClass}`}>
              <option value="">Select item…</option>
              {ogChoices.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} · {r.description}
                  {r.fine_mg != null ? ` · ${grams(r.fine_mg)} g fine` : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Callout tone="info">You cannot list old-gold items; enter the item id below.</Callout>
        )
      ) : canGold ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Approved melt batch"
            htmlFor="co-src-batch"
            hint={batches.data && batches.data.rows.length === 0 ? "No approved batch in this branch." : undefined}
          >
            <select
              id="co-src-batch"
              value={batchId}
              onChange={(e) => {
                setBatchId(e.target.value);
                setLotNumber("");
              }}
              className={`w-full ${controlClass}`}
            >
              <option value="">Select batch…</option>
              {(batches.data?.rows ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lot" htmlFor="co-src-lot" hint={batch.isFetching ? "Loading lots…" : undefined}>
            <select
              id="co-src-lot"
              value={lotNumber}
              disabled={!batchId}
              onChange={(e) => setLotNumber(e.target.value)}
              className={`w-full ${controlClass}`}
            >
              <option value="">Select lot…</option>
              {lotChoices.map((l) => (
                <option key={l.lot_number} value={l.lot_number}>
                  {l.lot_number} · {l.output_type} · {grams(l.fine_mg)} g fine
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : (
        <Callout tone="info">You cannot list melt batches; enter the lot reference below.</Callout>
      )}

      <Field
        label="Or enter the reference"
        htmlFor="co-src-manual"
        hint={
          kind === "CUSTOMER_OLDGOLD"
            ? "Old-gold item id. Overrides the picker when filled."
            : "batchId::lotNumber, e.g. 3f2c…::MLT-000001-01. Overrides the picker when filled."
        }
      >
        <input
          id="co-src-manual"
          value={manualRef}
          onChange={(e) => setManualRef(e.target.value)}
          className={`w-full g-metric ${controlClass}`}
        />
      </Field>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Production */

function StartProductionDialog({
  orderId,
  customerId,
  branchId,
  earmarked,
  onClose,
  onDone,
}: {
  orderId: string;
  customerId: string;
  branchId: string;
  earmarked: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [moId, setMoId] = useState("");
  // Only a DRAFT customer order for this customer and branch can be linked.
  const drafts = useQuery({
    queryKey: ["mfg-orders", "co-drafts", customerId, branchId],
    queryFn: () =>
      api<{ rows: MfgOrderRow[]; total: number }>(
        `/api/v1/manufacturing/orders?type=CUSTOMER&status=DRAFT&customerId=${customerId}&branchId=${branchId}&limit=50`
      ),
  });
  const start = useMutation({
    mutationFn: () =>
      api<{ manufacturingOrderId: string }>(`/api/v1/custom-orders/${orderId}/start-production`, {
        method: "POST",
        body: JSON.stringify({ manufacturingOrderId: moId || undefined }),
      }),
    onSuccess: () => {
      toast.success(moId ? "Production started on the linked order" : "Manufacturing order created — production started");
      onDone();
    },
    onError: (e) => toastError(e, "Could not start production"),
  });

  return (
    <Modal
      kicker="Custom order"
      title="Start production"
      onClose={onClose}
      onSubmit={() => start.mutate()}
      pending={start.isPending}
      submitLabel="Start production"
    >
      {earmarked === 0 ? (
        <Callout tone="warning" title="No gold earmarked">
          The linked manufacturing order only accepts earmarked lots as materials. Earmarking is closed once
          production starts.
        </Callout>
      ) : null}
      <Field
        label="Manufacturing order"
        htmlFor="co-mo"
        hint="Leave on “Create new” to open a customer manufacturing order from this design."
        error={drafts.isError ? errMsg(drafts.error, "Could not load draft orders") : undefined}
      >
        <select id="co-mo" value={moId} onChange={(e) => setMoId(e.target.value)} className={`w-full ${controlClass}`}>
          <option value="">Create new manufacturing order</option>
          {(drafts.data?.rows ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.number} · {m.design}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Deliver */

type PayMethod = "cash" | "card" | "bank" | "credit" | "other";
type PayDraft = { key: number; method: PayMethod; amount: string };

function DeliverDialog({
  orderId,
  quoteCents,
  advanceCents,
  pieces,
  piecesLoading,
  onClose,
  onDone,
}: {
  orderId: string;
  quoteCents: number;
  advanceCents: number;
  pieces: number;
  piecesLoading: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [payments, setPayments] = useState<PayDraft[]>([{ key: 1, method: "cash", amount: "" }]);
  const tax = useQuery({
    queryKey: ["pos-tax-config"],
    queryFn: () => api<{ rateBp: number; label: string }>("/api/v1/sales/tax-config"),
  });

  // Mirrors deliverOrder: the quote is net; tax is added per finished piece
  // and the applied advance (capped at the quote) comes off. The server
  // recomputes and names the exact figure if this ever disagrees.
  const rateBp = tax.data?.rateBp ?? 0;
  const pieceCents = pieces > 0 ? lkrToCents(quoteCents / 100 / pieces) : 0;
  const taxCents = pieces > 0 ? salesTaxCents(pieceCents, rateBp) * pieces : 0;
  const applyCents = Math.min(advanceCents, quoteCents);
  const balanceCents = quoteCents + taxCents - applyCents;

  // Fully covered by advances → the API expects no payment legs at all.
  const parsed = balanceCents > 0 ? payments.map((p) => ({ ...p, cents: toCents(p.amount) })) : [];
  const paidCents = parsed.reduce((n, p) => n + (Number.isFinite(p.cents) ? p.cents : 0), 0);
  const rowsValid = parsed.every((p) => Number.isFinite(p.cents) && p.cents > 0);
  const valid = !tax.isLoading && pieces > 0 && rowsValid && paidCents === Math.max(0, balanceCents);

  function set(key: number, patch: Partial<PayDraft>) {
    setPayments((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  const deliver = useMutation({
    mutationFn: () =>
      api<{ invoiceId: string }>(`/api/v1/custom-orders/${orderId}/deliver`, {
        method: "POST",
        body: JSON.stringify({ payments: parsed.map((p) => ({ method: p.method, amountLkr: p.cents / 100 })) }),
      }),
    onSuccess: () => {
      toast.success("Delivered — sale recorded");
      onDone();
    },
    onError: (e) => toastError(e, "Delivery failed"),
  });

  return (
    <Modal
      wide
      kicker="Custom order"
      title="Deliver piece"
      onClose={onClose}
      onSubmit={() => deliver.mutate()}
      pending={deliver.isPending}
      submitDisabled={!valid}
      submitLabel="Deliver and record sale"
    >
      {piecesLoading || tax.isLoading ? (
        <Skeleton className="h-24" />
      ) : pieces === 0 ? (
        <Callout tone="danger" title="No finished piece">
          The linked manufacturing order has no finished product yet. Finish it, then sync.
        </Callout>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-3">Quote ({pieces} piece{pieces === 1 ? "" : "s"})</dt>
            <dd className="text-right num-tabular text-ink">{lkr(quoteCents)}</dd>
            {rateBp > 0 ? (
              <>
                <dt className="text-ink-3">
                  {tax.data?.label ?? "Tax"} {(rateBp / 100).toFixed(2).replace(/\.00$/, "")}%
                </dt>
                <dd className="text-right num-tabular text-ink">{lkr(taxCents)}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Advances applied</dt>
            <dd className="text-right num-tabular text-ink">−{lkr(applyCents)}</dd>
            <dt className="border-t border-ink/10 pt-2 font-semibold text-ink">Balance due</dt>
            <dd className="border-t border-ink/10 pt-2 text-right font-semibold num-tabular text-ink">{lkr(balanceCents)} LKR</dd>
          </dl>

          {balanceCents > 0 ? (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.key} className="flex gap-2">
                  <label htmlFor={`co-pay-method-${p.key}`} className="sr-only">
                    Method
                  </label>
                  <select
                    id={`co-pay-method-${p.key}`}
                    value={p.method}
                    onChange={(e) => set(p.key, { method: e.target.value as PayMethod })}
                    className={controlClass}
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank">Bank</option>
                    <option value="credit">Credit (on account)</option>
                    <option value="other">Other</option>
                  </select>
                  <label htmlFor={`co-pay-amount-${p.key}`} className="sr-only">
                    Amount LKR
                  </label>
                  <input
                    id={`co-pay-amount-${p.key}`}
                    inputMode="decimal"
                    placeholder="Amount LKR"
                    value={p.amount}
                    onChange={(e) => set(p.key, { amount: e.target.value })}
                    className={`min-w-0 flex-1 num-tabular ${controlClass}`}
                  />
                  {payments.length > 1 ? (
                    <button
                      type="button"
                      aria-label="Remove payment"
                      onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}
                      className="g-btn g-btn-secondary h-10 px-3 text-xs text-rose-700"
                    >
                      <TrashIcon size={13} />
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={payments.length >= 10}
                  onClick={() => setPayments((ps) => [...ps, { key: Date.now(), method: "cash", amount: "" }])}
                  className="g-btn g-btn-secondary h-9 px-3 text-xs disabled:opacity-50"
                >
                  <PlusIcon size={13} /> Split payment
                </button>
                <span className={cn("text-xs num-tabular", paidCents === balanceCents ? "text-emerald-700" : "text-ink-4")}>
                  {lkr(paidCents)} of {lkr(balanceCents)} entered
                </span>
              </div>
            </div>
          ) : (
            <Callout tone="success">Advances cover the full amount — nothing more to collect.</Callout>
          )}
        </>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Cancel */

function CancelDialog({
  orderId,
  needsApprover,
  advanceCents,
  onClose,
  onDone,
}: {
  orderId: string;
  needsApprover: boolean;
  advanceCents: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: () =>
      api(`/api/v1/custom-orders/${orderId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim(), approvedBy: approvedBy.trim() || undefined }),
      }),
    onSuccess: () => {
      toast.success("Custom order cancelled");
      onDone();
    },
    onError: (e) => toastError(e, "Cancel failed", (err) => setPending(err.approvalId ?? err.message)),
  });

  return (
    <Modal
      kicker="Custom order"
      title="Cancel custom order"
      danger
      onClose={onClose}
      onSubmit={() => cancel.mutate()}
      pending={cancel.isPending}
      submitDisabled={!reason.trim() || (needsApprover && !approvedBy.trim())}
      submitLabel="Cancel order"
    >
      {pending ? (
        <Callout tone="warning" title="Waiting for approval">
          Request {pending} is in the Approval Center. Cancel again once it is approved.
        </Callout>
      ) : null}
      {advanceCents > 0 ? (
        <p className="text-sm text-ink-3">
          {lkr(advanceCents)} LKR of advances will be refunded in cash through a reversing entry. Card or bank advances
          must be reversed manually first.
        </p>
      ) : null}
      <Field label="Reason" htmlFor="co-cancel-reason">
        <input
          id="co-cancel-reason"
          autoFocus
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          className={`w-full ${controlClass}`}
        />
      </Field>
      {needsApprover ? (
        <Field
          label="Approver user id"
          htmlFor="co-cancel-approver"
          hint="Production has started: a second person with mfg:approve must sign off. You cannot approve your own cancel."
        >
          <input
            id="co-cancel-approver"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            className={`w-full g-metric ${controlClass}`}
          />
        </Field>
      ) : null}
    </Modal>
  );
}
