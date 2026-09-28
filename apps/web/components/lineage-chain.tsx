"use client";

import Link from "next/link";

export type LineageNode = { kind: string; id: string; label: string; link: string };
export type LineageEdge = { from: string; to: string; label: string };

const KIND_TONE: Record<string, string> = {
  sale_invoice: "bg-ink text-paper",
  product: "bg-gold text-ink",
  old_gold: "bg-ink/[0.08] text-ink",
  melting_batch: "bg-ink/[0.08] text-ink",
  refined_lot: "bg-gold/20 text-ink",
  purchase_invoice: "bg-ink/[0.08] text-ink",
};

export function LineageChain({ nodes, edges }: { nodes: LineageNode[]; edges: LineageEdge[] }) {
  if (nodes.length === 0) return <p className="text-sm text-ink-4">No lineage found.</p>;
  const labelOf = (key: string) => edges.filter((e) => e.to === key).map((e) => e.label)[0];
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {nodes.map((n) => (
        <li key={`${n.kind}:${n.id}`} className="flex items-center gap-2">
          <Link
            href={n.link}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${KIND_TONE[n.kind] ?? "bg-ink/[0.08] text-ink"}`}
            title={labelOf(`${n.kind}:${n.id}`) ?? n.kind}
          >
            {n.label}
          </Link>
        </li>
      ))}
    </ol>
  );
}
