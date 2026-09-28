"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Page, Hero, Panel, Callout, controlClass } from "@/components/ui";
import { ArrowRightIcon } from "@/components/icons";

type Customer = { id: string; name: string; code: string };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

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
    <Page>
      <Hero
        kicker="Old gold · Counter"
        title="Old gold intake"
        description="Customer → weigh → photograph → OG number."
        note="Every intake is photographed and weighed before it reaches the testing queue."
      />
      {created ? (
        <Callout
          tone="success"
          title={<>Item <span className="g-metric">{created.number}</span> received</>}
          action={
            <Link href={`/old-gold/items/${created.id}`} className="g-btn g-btn-secondary h-9 px-3 text-xs">
              Open for testing <ArrowRightIcon size={13} />
            </Link>
          }
        >
          <button
            onClick={() => { setCreated(null); setDescription(""); setGrossG(""); setStoneG(""); setFiles([]); }}
            className="font-medium underline"
          >
            Start a new intake
          </button>
        </Callout>
      ) : null}
      <Panel title="Receive item" description="Details recorded at the counter" className="max-w-3xl">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Customer</label>
            <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search name or phone…" className={`w-full ${controlClass}`} />
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`mt-2 w-full ${controlClass}`}>
              <option value="">Select customer…</option>
              {(customers.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-ink-2">Item type
              <input value={itemType} onChange={(e) => setItemType(e.target.value)} placeholder="chain, ring, bangle…" className={`mt-1 ${controlClass}`} />
            </label>
            <label className="block text-sm font-medium text-ink-2">Description
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={`mt-1 ${controlClass}`} />
            </label>
            <label className="block text-sm font-medium text-ink-2">Gross g
              <input type="number" step="any" value={grossG} onChange={(e) => setGrossG(e.target.value)} className={`mt-1 num-tabular ${controlClass}`} />
            </label>
            <label className="block text-sm font-medium text-ink-2">Stone g
              <input type="number" step="any" value={stoneG} onChange={(e) => setStoneG(e.target.value)} className={`mt-1 num-tabular ${controlClass}`} />
            </label>
          </div>
          <label className="block text-sm font-medium text-ink-2">Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${controlClass}`} />
          </label>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Photos (≤5MB each)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="w-full rounded-xl border border-dashed border-ink/20 bg-bone/60 px-4 py-5 text-sm text-ink-3 file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-paper"
            />
          </div>
          <button
            onClick={() => intake.mutate()}
            disabled={intake.isPending || !customerId || !description || !grossG}
            className="g-btn g-btn-primary h-11 px-5 text-sm"
          >
            {intake.isPending ? "Saving…" : "Receive item"}
          </button>
        </div>
      </Panel>
    </Page>
  );
}
