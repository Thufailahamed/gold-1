"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  Pill,
  Modal,
  controlClass,
} from "@/components/ui";

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
      <tr key={r.id}>
        <td>
          <Link href={`/old-gold/items/${r.id}`} className="g-metric text-xs font-medium text-ink hover:text-gold-700">
            {r.number}
          </Link>
        </td>
        <td className="text-ink-2">{r.description}</td>
        <td className="num-tabular">{(r.net_mg / 1000).toLocaleString("en-US")}g</td>
        <td>
          <Pill tone={r.status === "RECEIVED" ? "warning" : "info"} dot>{r.status}</Pill>
        </td>
        <td className="!text-right">
          <button
            onClick={() => setTestingId(r.id)}
            className="g-btn g-btn-secondary h-8 px-3 text-xs"
          >
            {r.status === "RECEIVED" ? "Test" : "Retest"}
          </button>
        </td>
      </tr>
    );
  }

  const waiting = queue.data?.rows.length ?? 0;
  const retests = retest.data?.rows.length ?? 0;

  return (
    <Page>
      <Hero
        kicker="Old gold · Lab"
        title="Purity testing"
        description="Assay every received piece before valuation — disagreements need a manager approval ID."
        note="A second opinion requires an approver — record the manager ID on the test."
        stats={[
          { label: "Awaiting test", value: waiting },
          { label: "Retest queue", value: retests },
        ]}
      />
      <TableCard title="Testing queue" description={`${waiting + retests} item${waiting + retests === 1 ? "" : "s"}`}>
        {queue.isLoading || retest.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : waiting + retests === 0 ? (
          <EmptyBlock title="Queue is empty" description="Nothing awaiting testing right now." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th>Net</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(queue.data?.rows ?? []).map(row)}
              {(retest.data?.rows ?? []).map(row)}
            </tbody>
          </table>
        )}
      </TableCard>
      {testingId ? (
        <Modal
          kicker="Old gold"
          title="Record test"
          onClose={() => setTestingId(null)}
          onSubmit={() => test.mutate()}
          pending={test.isPending}
          submitDisabled={!permille}
          submitLabel="Save test"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-ink-2">Method
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={controlClass}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-ink-2">Permille
              <input type="number" value={permille} onChange={(e) => setPermille(e.target.value)} placeholder="916" className={`num-tabular ${controlClass}`} />
            </label>
          </div>
          <label className="block text-sm text-ink-2">Result
            <select value={result} onChange={(e) => setResult(e.target.value)} className={controlClass}>
              <option value="pass">pass</option>
              <option value="fail">fail</option>
              <option value="inconclusive">inconclusive</option>
            </select>
          </label>
          <label className="block text-sm text-ink-2">Approver ID (only if disagreeing)
            <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Manager/owner ID" className={controlClass} />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
