"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  StatusPill,
  Pill,
  Modal,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";

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
  const active = rows.filter((r) => !["COMPLETE", "VOID"].includes(r.status)).length;

  return (
    <Page>
      <Hero
        kicker="Workshop"
        title="Manufacturing orders"
        description="Refined lots in, finished jewellery out."
        note="Materials allocate from approved melting lots — every gram is lineage-tracked."
        stats={[
          { label: "Orders", value: total },
          { label: "On this page", value: rows.length },
          { label: "In progress", value: active },
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
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
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
                  <td>
                    <Link href={`/manufacturing/orders/${o.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {o.number}
                    </Link>
                  </td>
                  <td><Pill tone="neutral">{o.type}</Pill></td>
                  <td className="font-medium text-ink">{o.design}</td>
                  <td className="text-ink-3">{o.customer_name ?? "—"}</td>
                  <td><StatusPill status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
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
          <div className="flex gap-2">
            {(["INTERNAL", "CUSTOMER"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`g-btn h-9 flex-1 px-3.5 text-xs ${type === t ? "g-btn-primary" : "g-btn-secondary"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {type === "CUSTOMER" ? (
            <div className="space-y-2">
              <input placeholder="Search customers…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className={controlClass} />
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={controlClass}>
                <option value="">Select customer…</option>
                {(customers.data?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="block text-sm text-ink-2">Design
            <input value={design} onChange={(e) => setDesign(e.target.value)} className={controlClass} />
          </label>
          <label className="block text-sm text-ink-2">Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={controlClass} />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
