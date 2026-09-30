"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { ItemEditor, type ItemDraft } from "@/components/purchase-items";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  StatusPill,
  Modal,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { FileTextIcon } from "@/components/icons";

type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
type Supplier = { id: string; name: string; code: string };

const ORDER_STATUSES = ["DRAFT", "SENT", "RECEIVED", "CANCELLED"];

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);

  // The purchasing dashboard links here with ?status= or ?new=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    if (s && ORDER_STATUSES.includes(s)) setFStatus(s);
    if (q.get("new") === "1") setDialog(true);
  }, []);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "purchases:create");
  const canCancel = hasPermission(me.data?.permissions ?? [], "purchases:cancel");

  const list = useQuery({
    queryKey: ["orders", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Order[]; total: number }>(
        `/api/v1/purchases/orders?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100"),
  });

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
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
            grossG: Number(it.grossG),
            estCostLkr: Number(it.costLkr),
            notes: undefined,
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Order created");
      setDialog(false);
      setSupplierId("");
      setNotes("");
      setItems([]);
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  async function cancel(id: string) {
    const reason = window.prompt("Reason to cancel (required):");
    if (!reason) return;
    try {
      await api(`/api/v1/purchases/orders/${id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      toast.success("Order cancelled");
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const open = rows.filter((r) => r.status === "DRAFT" || r.status === "SENT").length;

  return (
    <Page>
      <Hero
        kicker="Purchases"
        title="Purchase orders"
        description="Drafts — receiving posts stock, ledger and journal atomically."
        note="Receiving a draft creates products, stock movements and journal entries in one step."
        stats={[
          { label: "Orders", value: total },
          { label: "On this page", value: rows.length },
          { label: "Open drafts", value: open },
        ]}
        actions={
          canCreate ? (
            <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
              New order
            </button>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search by number…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={controlClass}
        />
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={controlClass}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <TableCard
        title="Purchase orders"
        icon={<FileTextIcon size={17} />}
        actions={<span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{String(total).padStart(2, "0")} on file</span>}
        footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="orders" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No orders" description="Create the first purchase order." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Supplier</th>
                <th className="!text-right">Items</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="g-metric font-medium text-ink">{o.number}</td>
                  <td>{o.supplier_name}</td>
                  <td className="!text-right num-tabular">{o.items}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="!text-right">
                    <span className="flex justify-end gap-3">
                      {(o.status === "DRAFT" || o.status === "SENT") && canCreate ? (
                        <button onClick={() => setReceiveId(o.id)} className="text-xs font-medium text-ink hover:underline">
                          Receive
                        </button>
                      ) : null}
                      {(o.status === "DRAFT" || o.status === "SENT") && canCancel ? (
                        <button onClick={() => cancel(o.id)} className="text-xs font-medium text-rose-600 hover:underline">
                          Cancel
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {dialog ? (
        <Modal
          wide
          kicker="Purchases"
          title="New purchase order"
          onClose={() => setDialog(false)}
          onSubmit={() => create.mutate()}
          pending={create.isPending}
          submitDisabled={!supplierId || items.length === 0}
          submitLabel="Save draft"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-ink-2">Supplier
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={controlClass}>
                <option value="">Select…</option>
                {(suppliers.data?.rows ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-ink-2">Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={controlClass} />
            </label>
          </div>
          <ItemEditor items={items} onChange={setItems} />
        </Modal>
      ) : null}
      {receiveId ? <ReceiveDialog id={receiveId} onClose={() => setReceiveId(null)} /> : null}
    </Page>
  );
}

function ReceiveDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const banks = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => api<{ id: string; name: string; account_code: string; is_active: number }[]>(
      "/api/v1/bank-accounts"
    ),
  });
  const [pending, setPending] = useState(false);

  async function receive() {
    setPending(true);
    try {
      const body: Record<string, unknown> = {};
      if (charges !== "") body.chargesLkr = Number(charges);
      if (paid !== "") {
        body.paidLkr = Number(paid);
        body.paidBankAccountId = bankAccountId;
      }
      const res = await api<{ number: string }>(`/api/v1/purchases/orders/${id}/receive`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(`Received as ${res.number}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Receive failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      kicker="Purchases"
      title="Receive order"
      onClose={onClose}
      onSubmit={receive}
      pending={pending}
      submitLabel="Receive"
    >
      <p className="text-sm text-ink-3">Creates products, stock, ledger and journal entries atomically.</p>
      <label className="block text-sm text-ink-2">Additional charges LKR
        <input type="number" step="any" value={charges} onChange={(e) => setCharges(e.target.value)} className={`num-tabular ${controlClass}`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-ink-2">Paid now LKR
          <input type="number" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} className={`num-tabular ${controlClass}`} />
        </label>
        <label className="block text-sm text-ink-2">Pay from
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className={controlClass}
          >
            <option value="">Choose an account…</option>
            {(banks.data ?? [])
              .filter((b) => b.is_active)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.account_code})
                </option>
              ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
