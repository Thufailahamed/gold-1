"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";

type QueueRow = { id: string; number: string; description: string; status: string; net_mg: number };

const METHODS = ["acid", "touchstone", "xrf", "electronic", "fire_assay"];

export default function TestingPage() {
  const qc = useQueryClient();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [method, setMethod] = useState("xrf");
  const [permille, setPermille] = useState("");
  const [result, setResult] = useState("pass");
  const [approvedBy, setApprovedBy] = useState("");

  const queue = useQuery({
    queryKey: ["og-queue"],
    queryFn: () =>
      api<{ rows: QueueRow[]; total: number }>(
        `/api/v1/oldgold/items?status=RECEIVED&limit=50`
      ),
  });
  const retest = useQuery({
    queryKey: ["og-retest"],
    queryFn: () =>
      api<{ rows: QueueRow[]; total: number }>(
        `/api/v1/oldgold/items?status=TESTED&limit=50`
      ),
  });

  const test = useMutation({
    mutationFn: () =>
      api(`/api/v1/oldgold/items/${testingId}/tests`, {
        method: "POST",
        body: JSON.stringify({
          method,
          permille: Number(permille),
          result,
          approvedBy: approvedBy || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Test recorded");
      setTestingId(null);
      setPermille("");
      setApprovedBy("");
      qc.invalidateQueries({ queryKey: ["og-queue"] });
      qc.invalidateQueries({ queryKey: ["og-retest"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Test failed"),
  });

  function row(r: QueueRow) {
    return (
      <tr key={r.id} className="border-b border-stone-100 last:border-0">
        <td className="px-4 py-2 font-mono text-xs">
          <Link href={`/old-gold/items/${r.id}`} className="hover:underline">{r.number}</Link>
        </td>
        <td className="px-4 py-2">{r.description}</td>
        <td className="px-4 py-2">{(r.net_mg / 1000).toLocaleString("en-US")}g</td>
        <td className="px-4 py-2 text-right">
          <button onClick={() => setTestingId(r.id)} className="text-xs underline">
            {r.status === "RECEIVED" ? "Test" : "Retest"}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Purity Testing</h1>
        <p className="text-sm text-stone-500">Disagreements need a manager approval ID</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Net</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(queue.data?.rows ?? []).map(row)}
            {(retest.data?.rows ?? []).map(row)}
          </tbody>
        </table>
      </div>
      {(queue.data?.rows.length ?? 0) + (retest.data?.rows.length ?? 0) === 0 && !queue.isLoading ? (
        <p className="text-sm text-stone-500">Queue is empty — nothing awaiting testing.</p>
      ) : null}
      {testingId ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">Record test</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Permille</label>
                <input type="number" value={permille} onChange={(e) => setPermille(e.target.value)} placeholder="916" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Result</label>
              <select value={result} onChange={(e) => setResult(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
                <option value="pass">pass</option>
                <option value="fail">fail</option>
                <option value="inconclusive">inconclusive</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Approver ID (only if disagreeing)</label>
              <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Manager/owner ID" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setTestingId(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => test.mutate()} disabled={test.isPending || !permille} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
                Save test
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
