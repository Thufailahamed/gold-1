import { View } from "react-native";
import { gramsShort, humanize, dateTime } from "@/lib/format";
import { useTheme } from "@/theme";
import { Icon, Row, StatusPill, Text, type IconName } from "@/ui";

export type StockRow = {
  key: string;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents?: number | null;
  name?: string | null;
  barcode?: string | null;
};

export type Movement = {
  id: string;
  product_id: string;
  barcode: string | null;
  type: string;
  from_status: string | null;
  to_status: string;
  from_branch: string | null;
  to_branch: string | null;
  weight_mg: number;
  reason: string | null;
  created_at: number;
};

export type Insights = {
  totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
  byKarat: { purity_id: string; karat: string; permille: number; pieces: number; net_mg: number; fine_mg: number; value_cents: number }[];
  byBranch: { branch_id: string; name: string; pieces: number; net_mg: number; fine_mg: number; value_cents: number }[];
  attention: { transfer_pending: number; in_repair: number; reserved: number; last_movement_at: number | null; movements_24h: number };
};

export type Piece = {
  product: {
    id: string;
    barcode: string;
    name: string;
    status: string;
    branch_id: string;
    net_mg: number;
    fine_gold_mg: number;
    cost_cents: number;
    karat: string;
    permille: number;
  };
};

export const MOVEMENT_TYPES: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "INTAKE", label: "Intake" },
  { key: "TRANSFER_OUT", label: "Transfer out" },
  { key: "TRANSFER_IN", label: "Transfer in" },
  { key: "RETURN", label: "Return" },
  { key: "RESTOCK", label: "Restock" },
  { key: "SALE_OUT", label: "Sale" },
  { key: "RESERVE", label: "Reserve" },
  { key: "RELEASE", label: "Release" },
  { key: "LOSS", label: "Loss" },
  { key: "VOID", label: "Void" },
];

const TYPE_ICON: Record<string, IconName> = {
  INTAKE: "package",
  TRANSFER_OUT: "truck",
  TRANSFER_IN: "truck",
  RETURN: "return",
  LOSS: "ban",
  VOID: "swap",
  SALE_OUT: "checkCircle",
  RESTOCK: "package",
  RESERVE: "lock",
  RELEASE: "unlock",
};

export function useTypeColor() {
  const { c } = useTheme();
  return (type: string): string =>
    ({
      INTAKE: c.green,
      RESTOCK: c.green,
      RELEASE: c.green,
      TRANSFER_OUT: c.gold,
      TRANSFER_IN: c.gold,
      RETURN: c.blue,
      LOSS: c.red,
      VOID: c.gray,
      SALE_OUT: c.indigo,
      RESERVE: c.orange,
    })[type] ?? c.gray;
}

/** One ledger line: type, barcode, from → to, branch, weight, reason and time. */
export function MovementRow({ m, branchName, onPress }: { m: Movement; branchName: (id: string | null) => string; onPress?: () => void }) {
  const { c } = useTheme();
  const color = useTypeColor()(m.type);
  return (
    <Row
      icon={TYPE_ICON[m.type] ?? "swap"}
      iconColor={color}
      onPress={onPress}
      title={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text variant="subhead" weight="600">
            {humanize(m.type)}
          </Text>
          <Text variant="footnote" mono tone="secondary">
            {m.barcode ?? m.product_id.slice(0, 8)}
          </Text>
        </View>
      }
      subtitle={
        <View style={{ gap: 3, marginTop: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text variant="caption1" tone="secondary">
              {m.from_status ? humanize(m.from_status) : "New"}
            </Text>
            <Icon name="arrowRight" size={10} color={c.label3} />
            <StatusPill status={m.to_status} label={humanize(m.to_status)} size="sm" />
          </View>
          <Text variant="caption1" tone="tertiary" numberOfLines={2}>
            {`${branchName(m.to_branch ?? m.from_branch)} · ${dateTime(m.created_at)}${m.reason ? ` · ${m.reason}` : ""}`}
          </Text>
        </View>
      }
      right={
        <Text variant="subhead" num tone="secondary">
          {gramsShort(m.weight_mg)} g
        </Text>
      }
    />
  );
}
