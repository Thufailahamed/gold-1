import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { compact } from "@/lib/format";
import { useTheme } from "@/theme";
import { Text } from "./Text";

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

/** Smooth path through points (monotone-ish cubic). */
function smooth(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`;
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const mx = (p0.x + p1.x) / 2;
    d += ` C${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
  }
  return d;
}

export type SeriesPoint = { label: string; value: number | null; value2?: number | null };

/**
 * Area chart (gold) with an optional dashed second line, x labels and
 * compact y gridlines. Tapping a column shows its values.
 */
export function AreaChart({
  data,
  height = 190,
  format = compact,
  seriesLabels = ["Value", "Secondary"],
}: {
  data: SeriesPoint[];
  height?: number;
  format?: (n: number) => string;
  seriesLabels?: [string, string];
}) {
  const { c } = useTheme();
  const [w, onLayout] = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const padL = 40;
  const padB = 22;
  const padT = 10;
  const vals = data.flatMap((d) => [d.value, d.value2]).filter((v): v is number => typeof v === "number");
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const innerW = Math.max(1, w - padL - 6);
  const innerH = height - padB - padT;
  const x = (i: number) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
  const p1 = data.map((d, i) => (d.value === null ? null : { x: x(i), y: y(d.value) })).filter((p): p is { x: number; y: number } => !!p);
  const p2 = data.map((d, i) => (d.value2 === null || d.value2 === undefined ? null : { x: x(i), y: y(d.value2) })).filter((p): p is { x: number; y: number } => !!p);
  const line = smooth(p1);
  const area = p1.length ? `${line} L${p1[p1.length - 1]!.x},${padT + innerH} L${p1[0]!.x},${padT + innerH} Z` : "";
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
  const s = sel !== null ? data[sel] : null;
  return (
    <View onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="af" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.goldBright} stopOpacity={0.35} />
              <Stop offset="1" stopColor={c.goldBright} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="as" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={c.goldLight} />
              <Stop offset="1" stopColor={c.gold} />
            </LinearGradient>
          </Defs>
          {ticks.map((t, i) => (
            <G key={i}>
              <Line x1={padL} x2={w - 6} y1={y(t)} y2={y(t)} stroke={c.hairline} strokeDasharray="3 5" />
              <SvgText x={padL - 6} y={y(t) + 4} fontSize={10} fill={c.label2} textAnchor="end">
                {format(t)}
              </SvgText>
            </G>
          ))}
          {area ? <Path d={area} fill="url(#af)" /> : null}
          {line ? <Path d={line} stroke="url(#as)" strokeWidth={2.5} fill="none" strokeLinecap="round" /> : null}
          {p2.length > 1 ? <Path d={smooth(p2)} stroke={c.label} strokeWidth={1.5} strokeDasharray="4 4" fill="none" /> : null}
          {data.map((d, i) => (
            <SvgText key={d.label + i} x={x(i)} y={height - 6} fontSize={10} fill={c.label2} textAnchor="middle">
              {d.label}
            </SvgText>
          ))}
          {sel !== null && data[sel]?.value !== null && data[sel] ? (
            <G>
              <Line x1={x(sel)} x2={x(sel)} y1={padT} y2={padT + innerH} stroke={c.gold} strokeDasharray="3 3" />
              <Circle cx={x(sel)} cy={y(data[sel]!.value ?? 0)} r={5} fill={c.goldLight} stroke={c.card} strokeWidth={2} />
            </G>
          ) : null}
          {data.map((_, i) => (
            <Rect
              key={`hit${i}`}
              x={x(i) - innerW / Math.max(1, data.length) / 2}
              y={0}
              width={innerW / Math.max(1, data.length)}
              height={height}
              fill="transparent"
              onPress={() => setSel(sel === i ? null : i)}
            />
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      {s ? (
        <View style={{ flexDirection: "row", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
          <Text variant="footnote" weight="600">
            {s.label}
          </Text>
          <Text variant="footnote" tone="secondary" num>
            {seriesLabels[0]}: {s.value === null ? "—" : format(s.value)}
          </Text>
          {s.value2 !== undefined ? (
            <Text variant="footnote" tone="secondary" num>
              {seriesLabels[1]}: {s.value2 === null ? "—" : format(s.value2)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Vertical bars with labels; negative values drawn in red. */
export function BarChart({
  data,
  height = 170,
  format = compact,
  color,
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
  color?: string;
}) {
  const { c } = useTheme();
  const [w, onLayout] = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const padB = 22;
  const padT = 16;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const innerH = height - padB - padT;
  const slot = data.length ? w / data.length : 0;
  const bw = Math.min(28, slot * 0.6);
  return (
    <View onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.goldLight} />
              <Stop offset="1" stopColor={c.gold} />
            </LinearGradient>
          </Defs>
          <Line x1={0} x2={w} y1={padT + innerH} y2={padT + innerH} stroke={c.hairline} />
          {data.map((d, i) => {
            const h = Math.max(2, (Math.abs(d.value) / max) * innerH);
            const cx = slot * i + slot / 2;
            return (
              <G key={d.label + i} onPress={() => setSel(sel === i ? null : i)}>
                <Rect x={cx - slot / 2} y={0} width={slot} height={height} fill="transparent" />
                <Rect
                  x={cx - bw / 2}
                  y={padT + innerH - h}
                  width={bw}
                  height={h}
                  rx={Math.min(6, bw / 2)}
                  fill={d.value < 0 ? c.red : color ?? "url(#bg)"}
                  opacity={sel === null || sel === i ? 1 : 0.45}
                />
                <SvgText x={cx} y={height - 6} fontSize={10} fill={c.label2} textAnchor="middle">
                  {d.label}
                </SvgText>
                {sel === i ? (
                  <SvgText x={cx} y={Math.max(11, padT + innerH - h - 5)} fontSize={10} fontWeight="600" fill={c.label} textAnchor="middle">
                    {format(d.value)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

/** Tiny trend line for list rows / tiles. */
export function Sparkline({ values, width = 80, height = 28, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  const { c } = useTheme();
  if (values.length < 2) return <View style={{ width, height }} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * width, y: height - 2 - ((v - min) / (max - min || 1)) * (height - 4) }));
  return (
    <Svg width={width} height={height}>
      <Path d={smooth(pts)} stroke={color ?? c.gold} strokeWidth={2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** Progress ring (0–100) with centre content — the web GaugeRing. */
export function Ring({
  percent,
  size = 120,
  stroke = 10,
  children,
  track,
  dark,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  track?: string;
  dark?: boolean;
}) {
  const { c } = useTheme();
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFF4C7" />
            <Stop offset="0.45" stopColor="#E7C65A" />
            <Stop offset="1" stopColor="#A8861B" />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track ?? (dark ? "rgba(255,255,255,0.08)" : c.fill)} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#rg)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${len} ${len}`}
          strokeDashoffset={len * (1 - p / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>{children}</View>
    </View>
  );
}

const DONUT = ["#C9A227", "#1C1917", "#8C6D1F", "#E7C65A", "#78716C", "#30B0C7", "#AF52DE", "#FF9500"];

/** Donut with legend for composition breakdowns. */
export function Donut({ items, size = 140, format }: { items: { label: string; value: number }[]; size?: number; format: (n: number) => string }) {
  const { c, dark } = useTheme();
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  let acc = 0;
  const colors = DONUT.map((col) => (dark && col === "#1C1917" ? "#E7E5E4" : col));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.fill} strokeWidth={stroke} fill="none" />
        {items.map((it, i) => {
          const frac = Math.max(0, it.value) / total;
          const el = (
            <Circle
              key={it.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={colors[i % colors.length]}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${Math.max(0, frac * len - 2)} ${len}`}
              strokeDashoffset={-acc * len}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          acc += frac;
          return el;
        })}
      </Svg>
      <View style={{ flex: 1, gap: 8 }}>
        {items.map((it, i) => (
          <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 9, height: 9, borderRadius: 3, borderCurve: "continuous", backgroundColor: colors[i % colors.length] }} />
            <Text variant="footnote" numberOfLines={1} style={{ flex: 1 }}>
              {it.label}
            </Text>
            <Text variant="footnote" tone="secondary" num>
              {format(it.value)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
