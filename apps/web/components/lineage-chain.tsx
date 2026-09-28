import Link from "next/link";

export type LineageNode = {
  key: string;
  kind: string;
  label: string;
  url: string | null;
};

export type LineageEdge = { from: string; to: string };

const DOT: Record<string, string> = {
  old_gold: "bg-amber-500",
  melting_batch: "bg-violet-500",
  manufacturing_order: "bg-sky-500",
  product: "bg-emerald-500",
};

/** Order nodes along the edge chain (roots first) so the flow reads left→right. */
function orderNodes(nodes: LineageNode[], edges: LineageEdge[]): LineageNode[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const indeg = new Map(nodes.map((n) => [n.key, 0]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  }
  const out: LineageNode[] = [];
  const queue = nodes.filter((n) => (indeg.get(n.key) ?? 0) === 0).map((n) => n.key);
  const seen = new Set<string>();
  while (queue.length) {
    const k = queue.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const n = byKey.get(k);
    if (n) out.push(n);
    for (const next of adj.get(k) ?? []) queue.push(next);
  }
  for (const n of nodes) if (!seen.has(n.key)) out.push(n);
  return out;
}

export function LineageChain({ nodes, edges }: { nodes: LineageNode[]; edges: LineageEdge[] }) {
  const ordered = orderNodes(nodes, edges);
  if (ordered.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/15 bg-bone/60 px-4 py-6 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-4">No lineage found</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-y-3">
      {ordered.map((n, i) => {
        const chip = (
          <span className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-paper px-3.5 py-1.5 text-xs shadow-hairline transition-colors hover:border-gold/50">
            <span className={`size-1.5 shrink-0 rounded-full ${DOT[n.kind] ?? "bg-ink/40"}`} />
            <span className="font-mono font-medium tracking-tight text-ink">{n.label}</span>
            <span className="text-[10px] uppercase tracking-wider text-ink-4">{n.kind.replace(/_/g, " ")}</span>
          </span>
        );
        return (
          <span key={n.key} className="inline-flex items-center">
            {i > 0 ? <span className="mx-2 font-mono text-xs text-gold">→</span> : null}
            {n.url ? (
              <Link href={n.url} className="transition-transform hover:-translate-y-px">{chip}</Link>
            ) : (
              chip
            )}
          </span>
        );
      })}
    </div>
  );
}
