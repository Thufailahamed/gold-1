import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import { Icon } from "./Icon";
import { Text } from "./Text";

export type LineageNode = {
  key?: string;
  id?: string;
  kind: string;
  label: string;
  url?: string | null;
  link?: string | null;
};

export type LineageEdge = { from: string; to: string; label?: string };

const DOT: Record<string, string> = {
  old_gold: "#FF9500",
  melting_batch: "#AF52DE",
  manufacturing_order: "#30B0C7",
  product: "#34C759",
};

function getNodeKey(n: LineageNode, fallbackIndex?: number): string {
  if (n.key) return n.key;
  if (n.kind && n.id) return `${n.kind}:${n.id}`;
  if (n.id) return n.id;
  return `node-${fallbackIndex ?? 0}`;
}

/** Order nodes along the edge chain (roots first) so the flow reads top→bottom. */
function orderNodes(nodes: LineageNode[], edges: LineageEdge[]): LineageNode[] {
  const byKey = new Map(nodes.map((n, i) => [getNodeKey(n, i), n]));
  const indeg = new Map(nodes.map((n, i) => [getNodeKey(n, i), 0]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  }
  const out: LineageNode[] = [];
  const queue = nodes.filter((n, i) => (indeg.get(getNodeKey(n, i)) ?? 0) === 0).map((n, i) => getNodeKey(n, i));
  const seen = new Set<string>();
  while (queue.length) {
    const k = queue.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const n = byKey.get(k);
    if (n) out.push(n);
    for (const next of adj.get(k) ?? []) queue.push(next);
  }
  for (const [i, n] of nodes.entries()) {
    const k = getNodeKey(n, i);
    if (!seen.has(k)) out.push(n);
  }
  return out;
}

/**
 * Gold provenance chain (old gold → melting → manufacturing → product) as a
 * vertical timeline. Nodes with a url/link open that record.
 */
export function LineageChain({ nodes, edges }: { nodes: LineageNode[]; edges: LineageEdge[] }) {
  const { c } = useTheme();
  const ordered = orderNodes(nodes, edges);
  if (ordered.length === 0) {
    return (
      <View style={{ paddingVertical: 18, alignItems: "center" }}>
        <Text variant="caption1" tone="secondary" upper>
          No lineage found
        </Text>
      </View>
    );
  }
  return (
    <View>
      {ordered.map((n, i) => {
        const link = n.url ?? n.link;
        const last = i === ordered.length - 1;
        const color = DOT[n.kind] ?? c.gray;
        return (
          <Pressable
            key={getNodeKey(n, i)}
            disabled={!link}
            onPress={() => {
              haptic.selection();
              if (link) router.push(link as Href);
            }}
          >
            {({ pressed }) => (
              <View style={{ flexDirection: "row", gap: 12, opacity: pressed ? 0.6 : 1 }}>
                <View style={{ alignItems: "center", width: 14 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, borderCurve: "continuous", backgroundColor: color, marginTop: 4, borderWidth: 2, borderColor: c.card }} />
                  {!last ? <View style={{ width: 2, flex: 1, backgroundColor: c.goldSoft, marginVertical: 2 }} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: last ? 0 : 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="subhead" mono weight="600" numberOfLines={1}>
                      {n.label}
                    </Text>
                    <Text variant="caption1" tone="secondary" upper>
                      {n.kind.replace(/_/g, " ")}
                    </Text>
                  </View>
                  {link ? <Icon name="chevronRight" size={12} color={c.label3} weight="bold" /> : null}
                </View>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
