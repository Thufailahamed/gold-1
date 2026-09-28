"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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
import { CreditCardIcon } from "@/components/icons";

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
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const STATUSES = ["UNPAID", "PARTIAL", "PAID", "VOID"];
const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function InvoicesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "purchases:create");

  const list = useQuery({
    queryKey: ["invoices", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Invoice[]; total: number }>(
        `/api/v1/purchases/invoices?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100"),
  });

  const [supplierId, setSupplierId] = useState("");
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/invoices", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId: branchDefault(),
          chargesLkr: charges === "" ? 0 : Number(charges),
          paidLkr: paid === "" ? 0 : Number(paid),
          paidMethod: paid === "" ? undefined : method,
          items: items.map((it) => ({
            categoryId: it.categoryId,
            metalTypeId: it.metalTypeId,
            purityId: it.purityId,
            name: it.name,
            grossG: Number(it.grossG),
            costLkr: Number(it.costLkr),
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Invoice created");
      setDialog(false);
      setSupplierId("");
      setCharges("");
      setPaid("");
      setItems([]);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const outstanding = rows.reduce((n, r) => n + (r.status === "VOID" ? 0 : Math.max(0, r.total_cents - r.paid_cents)), 0);

  return (
    <Page>
      <Hero
        kicker="Purchases"
        title="Purchase invoices"
        description="Stock, ledger and journal post atomically."
        note="Unpaid and partial balances become supplier payables on the ledger."
        stats={[
          { label: "Invoices", value: total },
          { label: "On this page", value: rows.length },
          { label: "Outstanding", value: `${fmt(outstanding)} LKR` },
        ]}
        actions={
          canCreate ? (
            <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
              New invoice
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
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <TableCard
        title="Invoices"
        icon={<CreditCardIcon size={17} />}
        actions={<span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{String(total).padStart(2, "0")} on file</span>}
        footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="invoices" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No invoices" description="Post the first purchase invoice." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Supplier</th>
                <th className="!text-right">Total</th>
                <th className="!text-right">Paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/purchases/invoices/${r.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.supplier_name}</td>
                  <td className="!text-right num-tabular font-medium text-ink">{fmt(r.total_cents)}</td>
                  <td className="!text-right num-tabular">{fmt(r.paid_cents)}</td>
                  <td><StatusPill status={r.status} /></td>
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
          title="New invoice (direct intake)"
          onClose={() => setDialog(false)}
          onSubmit={() => create.mutate()}
          pending={create.isPending}
          submitDisabled={!supplierId || items.length === 0}
          submitLabel="Post invoice"
        >
          <label className="block text-sm text-ink-2">Supplier
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={controlClass}>
              <option value="">Select…</option>
              {(suppliers.data?.rows ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </label>
          <ItemEditor items={items} onChange={setItems} />
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm text-ink-2">Charges LKR
              <input type="number" step="any" value={charges} onChange={(e) => setCharges(e.target.value)} className={`num-tabular ${controlClass}`} />
            </label>
            <label className="block text-sm text-ink-2">Paid LKR
              <input type="number" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} className={`num-tabular ${controlClass}`} />
            </label>
            <label className="block text-sm text-ink-2">Method
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={controlClass}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
            </label>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
