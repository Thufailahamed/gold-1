"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, Hero, TableCard, TableSkeleton, Pager, EmptyBlock, controlClass } from "@/components/ui";

type Order = { id: string; number: string; type: string; design: string; status: string; customer_name: string | null; created_at: number };
type Customer = { id: string; name: string; code: string };

const STATUSES = ["DRAFT", "ALLOCATED", "IN_PRODUCTION", "QC_PASSED", "QC_FAILED", "COMPLETE", "VOID"];

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
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "mfg:create");

  const list = useQuery({
    queryKey: ["mfg-orders", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Order[]; total: number }>(
        `/api/v1/manufacturing/orders?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });
  const customers = useQuery({
    queryKey: ["mfg-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(
        `/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`
      ),
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
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  return (
    <Page>
      <Hero
        kicker="Manufacturing"
        title="Orders"
        description="Refined lots in, finished jewellery out."
        actions={
          canCreate ? (
            <button onClick={() => setDialog(true)} className="g-btn bg-gold px-4 text-sm text-ink">
              New order
            </button>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search number or design…"
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
      <TableCard footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="orders" />}>
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No orders" description="Create the first manufacturing order." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Type</th>
                <th>Design</th>
                <th>Customer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono">
                    <Link href={`/manufacturing/orders/${o.id}`} className="hover:underline">{o.number}</Link>
                  </td>
                  <td>{o.type}</td>
                  <td>{o.design}</td>
                  <td className="text-ink-3">{o.customer_name ?? "—"}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {dialog ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">New manufacturing order</h2>
            <div className="flex gap-2">
              {(["INTERNAL", "CUSTOMER"] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={`rounded-md px-3 py-1.5 text-sm ${type === t ? "bg-stone-900 text-white" : "border"}`}>
                  {t}
                </button>
              ))}
            </div>
            {type === "CUSTOMER" ? (
              <>
                <input placeholder="Search customers…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className={controlClass} />
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={controlClass}>
                  <option value="">Select customer…</option>
                  {(customers.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </>
            ) : null}
            <label className="block text-sm">Design<input value={design} onChange={(e) => setDesign(e.target.value)} className={controlClass} /></label>
            <label className="block text-sm">Description<input value={description} onChange={(e) => setDescription(e.target.value)} className={controlClass} /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => create.mutate()} disabled={create.isPending || !design || (type === "CUSTOMER" && !customerId)} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
