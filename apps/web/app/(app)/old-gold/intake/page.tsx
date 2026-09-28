"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Customer = { id: string; name: string; code: string };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const inputCls =
  "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

export default function IntakePage() {
  const qc = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [itemType, setItemType] = useState("chain");
  const [description, setDescription] = useState("");
  const [grossG, setGrossG] = useState("");
  const [stoneG, setStoneG] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);

  const customers = useQuery({
    queryKey: ["og-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(
        `/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`
      ),
    enabled: customerSearch.length > 0,
  });

  const intake = useMutation({
    mutationFn: async () => {
      const res = await api<{ id: string; number: string }>("/api/v1/oldgold/items", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          branchId: branchDefault(),
          itemType,
          description,
          grossG: Number(grossG),
          stoneG: stoneG === "" ? 0 : Number(stoneG),
          notes: notes || undefined,
        }),
      });
      for (const f of files.slice(0, 10)) {
        const form = new FormData();
        form.append("kind", "image");
        form.append("file", f);
        await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"}/api/v1/oldgold/items/${res.id}/files`,
          { method: "POST", body: form, credentials: "include" }
        );
      }
      return res;
    },
    onSuccess: (d) => {
      setCreated(d);
      toast.success(`Intake ${d.number}`);
      qc.invalidateQueries({ queryKey: ["og-items"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Intake failed"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Old Gold Intake</h1>
        <p className="text-sm text-stone-500">Customer → weigh → photograph → OG number</p>
      </div>
      {created ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          Item <span className="font-mono font-semibold">{created.number}</span> received.{" "}
          <Link href={`/old-gold/items/${created.id}`} className="underline">
            Open for testing →
          </Link>{" "}
          <button onClick={() => { setCreated(null); setDescription(""); setGrossG(""); setStoneG(""); setFiles([]); }} className="ml-2 underline">
            New intake
          </button>
        </div>
      ) : null}
      <div className="max-w-2xl space-y-3 rounded-xl border border-stone-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Customer search</label>
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Name or phone…" className={inputCls} />
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`mt-2 ${inputCls}`}>
            <option value="">Select customer…</option>
            {(customers.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Item type</label>
            <input value={itemType} onChange={(e) => setItemType(e.target.value)} placeholder="chain, ring, bangle…" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Gross g</label>
            <input type="number" step="any" value={grossG} onChange={(e) => setGrossG(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Stone g</label>
            <input type="number" step="any" value={stoneG} onChange={(e) => setStoneG(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Photos (≤5MB each)</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="w-full text-sm" />
        </div>
        <button
          onClick={() => intake.mutate()}
          disabled={intake.isPending || !customerId || !description || !grossG}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {intake.isPending ? "Saving…" : "Receive item"}
        </button>
      </div>
    </div>
  );
}
