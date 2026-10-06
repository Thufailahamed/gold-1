import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import { useCountUp } from "@/lib/count-up";
import { haptic } from "@/lib/haptics";
import { GUTTER, radius, squircle, useTheme } from "@/theme";
import { Hero } from "./Card";
import { Icon, type IconName } from "./Icon";
import { Separator } from "./List";
import { Skeleton } from "./States";
import { PressableScale } from "./PressableScale";
import { Kicker, Text } from "./Text";

const today = () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

export type HeroMetricDef = {
  label: string;
  value: number | undefined;
  format: (n: number) => string;
  unit?: string;
  href?: string;
};

function Metric({ m }: { m: HeroMetricDef }) {
  const shown = useCountUp(m.value);
  return <>{m.value === undefined ? "—" : `${m.format(shown)}${m.unit ? ` ${m.unit}` : ""}`}</>;
}

/**
 * Dark module hero (web ModuleHero): kicker + today's date, title, blurb,
 * actions and a 2×2 metric strip whose cells link into the module.
 */
export function ModuleHero({
  kicker,
  title,
  description,
  actions,
  metrics,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  metrics: HeroMetricDef[];
}) {
  return (
    <Hero kicker={`${kicker} · ${today()}`} title={title} subtitle={description} style={{ marginTop: 8 }}>
      {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>{actions}</View> : null}
      {metrics.length ? (
        <View style={styles.strip}>
          {metrics.map((m, i) => (
            <Pressable
              key={m.label}
              disabled={!m.href}
              onPress={() => {
                haptic.selection();
                if (m.href) router.push(m.href as Href);
              }}
              style={({ pressed }) => [
                styles.cell,
                { borderLeftWidth: i % 2 === 1 ? StyleSheet.hairlineWidth : 0, borderTopWidth: i >= 2 ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text variant="caption2" tone="onVault3" weight="600" upper numberOfLines={1} style={{ letterSpacing: 0.9 }}>
                {m.label}
              </Text>
              <Text variant="title3" tone="onVault" num rounded numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 4 }}>
                <Metric m={m} />
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Hero>
  );
}

export type BoardState = { status: string; label: string; hint: string; color: string };

/**
 * Proportion bar over status rows, each row linking to its filtered list
 * (web StatusBoard).
 */
export function StatusBoard({
  title,
  subtitle,
  icon,
  states,
  counts,
  loading,
  href,
  format = (n) => String(n),
  action,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  states: BoardState[];
  counts: (number | undefined)[];
  loading?: boolean;
  href: (status: string) => string;
  format?: (n: number) => string;
  action?: { label: string; onPress: () => void };
}) {
  const { c } = useTheme();
  const total = counts.reduce<number>((a, n) => a + (n ?? 0), 0);
  return (
    <View style={{ marginHorizontal: GUTTER, marginTop: 22, backgroundColor: c.card, borderRadius: radius.xl - 2, ...squircle, overflow: "hidden" }}>
      <View style={{ padding: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, ...squircle, backgroundColor: c.goldSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={15} color={c.goldInk} weight="semibold" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{title}</Text>
          {subtitle ? (
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? (
          <Pressable hitSlop={8} onPress={action.onPress}>
            <Text variant="subhead" color={c.gold} weight="600">
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ marginHorizontal: 16, height: 8, borderRadius: 4, borderCurve: "continuous", backgroundColor: c.fill, flexDirection: "row", overflow: "hidden" }}>
        {total > 0
          ? states.map((s, i) => {
              const n = counts[i] ?? 0;
              return n > 0 ? <View key={s.status} style={{ width: `${(n / total) * 100}%`, backgroundColor: s.color, borderRightWidth: 2, borderRightColor: c.card }} /> : null;
            })
          : null}
      </View>
      <View style={{ marginTop: 12 }}>
        {states.map((s, i) => (
          <View key={s.status}>
            <Separator indent={16} />
            <Pressable
              onPress={() => {
                haptic.selection();
                router.push(href(s.status) as Href);
              }}
            >
              {({ pressed }) => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: pressed ? c.highlight : "transparent" }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, borderCurve: "continuous", backgroundColor: s.color }} />
                  <View style={{ flex: 1 }}>
                    <Text variant="subhead" weight="600">
                      {s.label}
                    </Text>
                    <Text variant="caption1" tone="secondary" numberOfLines={1}>
                      {s.hint}
                    </Text>
                  </View>
                  {loading ? (
                    <Skeleton width={34} height={22} />
                  ) : (
                    <Text variant="title3" num rounded>
                      {counts[i] === undefined ? "—" : format(counts[i] ?? 0)}
                    </Text>
                  )}
                  <Icon name="chevronRight" size={12} color={c.label3} weight="bold" />
                </View>
              )}
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Entry card for one of a module's workspaces (web ModuleCard). */
export function ModuleCard({
  href,
  icon,
  title,
  description,
  metric,
  metricLabel,
  loading,
  alert,
}: {
  href: string;
  icon: IconName;
  title: string;
  description: string;
  metric: ReactNode;
  metricLabel: string;
  loading?: boolean;
  alert?: boolean;
}) {
  const { c } = useTheme();
  return (
    <PressableScale
      scaleTo={0.97}
      onPress={() => {
        haptic.selection();
        router.push(href as Href);
      }}
      style={{ flex: 1, backgroundColor: c.card, borderRadius: radius.xl - 4, ...squircle, padding: 14 }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, ...squircle, backgroundColor: c.goldSoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={17} color={c.goldInk} weight="semibold" />
      </View>
      <Text variant="headline" style={{ marginTop: 12 }} numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption1" tone="secondary" numberOfLines={2} style={{ marginTop: 2, minHeight: 32 }}>
        {description}
      </Text>
      <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }}>
        {loading ? (
          <Skeleton width={50} height={22} />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text variant="title3" num rounded numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
              {metric}
            </Text>
            {alert ? <View style={{ width: 8, height: 8, borderRadius: 4, borderCurve: "continuous", backgroundColor: c.orange }} /> : null}
          </View>
        )}
        <Kicker style={{ marginTop: 3 }}>{metricLabel}</Kicker>
      </View>
    </PressableScale>
  );
}

/** Two ModuleCards per row. */
export function ModuleGrid({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View style={{ marginHorizontal: GUTTER, marginTop: 16, gap: 10 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10 }}>
          {r}
          {r.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, marginHorizontal: -20, marginBottom: -20, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)" },
  cell: { width: "50%", paddingVertical: 14, paddingHorizontal: 20, borderColor: "rgba(255,255,255,0.1)" },
});
