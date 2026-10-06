import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme, type Palette } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand" | "dark" | "blue";

function toneColors(c: Palette, dark: boolean, tone: PillTone) {
  switch (tone) {
    case "success":
      return { bg: dark ? "rgba(48,209,88,0.18)" : "rgba(52,199,89,0.14)", fg: c.greenText, dot: c.green };
    case "warning":
      return { bg: dark ? "rgba(255,159,10,0.18)" : "rgba(255,149,0,0.14)", fg: c.orangeText, dot: c.orange };
    case "danger":
      return { bg: dark ? "rgba(255,69,58,0.18)" : "rgba(255,59,48,0.12)", fg: c.redText, dot: c.red };
    case "info":
      return { bg: c.goldSoft, fg: c.goldInk, dot: c.gold };
    case "brand":
      return { bg: c.goldBright, fg: c.onGold, dot: c.onGold };
    case "dark":
      return { bg: c.vault, fg: c.goldLight, dot: c.goldLight };
    case "blue":
      return { bg: dark ? "rgba(10,132,255,0.2)" : "rgba(0,122,255,0.12)", fg: c.blue, dot: c.blue };
    default:
      return { bg: c.fill, fg: c.label2, dot: c.gray };
  }
}

export function Pill({
  children,
  tone = "neutral",
  dot,
  icon,
  size = "md",
  style,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  dot?: boolean;
  icon?: IconName;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  const t = toneColors(c, dark, tone);
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 5,
          backgroundColor: t.bg,
          borderRadius: 999, borderCurve: "continuous",
          paddingHorizontal: size === "sm" ? 7 : 9,
          paddingVertical: size === "sm" ? 2 : 3.5,
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: t.dot }} /> : null}
      {icon ? <Icon name={icon} size={size === "sm" ? 10 : 11} color={t.fg} weight="bold" /> : null}
      <Text variant={size === "sm" ? "caption2" : "caption1"} weight="600" color={t.fg} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Maps workflow statuses to a tone (same rules as the web StatusPill), so any
 * status string from the API can be passed straight in.
 */
export function statusTone(status: string | null | undefined): PillTone {
  const s = (status ?? "").toLowerCase();
  if (/(fail|error|reject|cancel|disput|suspend|block|ban|revok|overdue|breach|critical|declin|fraud|expired|lost|void|melt)/.test(s)) return "danger";
  if (/(pend|review|await|hold|queue|draft|warn|processing|progress|open|retry|partial|unpaid|unverified|flag|repair|manufacturing|reserved)/.test(s)) return "warning";
  if (/(success|succeed|complete|deliver|paid|approv|verif|active|resolv|settled|healthy|ok|enabled|live|accept|confirm|sent|published|clear|in_stock|sold|post)/.test(s)) return "success";
  if (/(transit|ship|prepar|dispatch|scheduled|refund|return|transfer)/.test(s)) return "info";
  return "neutral";
}

export const statusLabel = (status: string | null | undefined) =>
  (status ?? "-").replace(/[_-]+/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase());

export function StatusPill({ status, label, size, style }: { status: string | null | undefined; label?: string; size?: "sm" | "md"; style?: StyleProp<ViewStyle> }) {
  return (
    <Pill tone={statusTone(status)} dot size={size} style={style}>
      {label ?? statusLabel(status)}
    </Pill>
  );
}
