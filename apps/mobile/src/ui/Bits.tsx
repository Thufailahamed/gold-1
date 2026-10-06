import { View, type StyleProp, type ViewStyle } from "react-native";
import { type Href } from "expo-router";
import { useBranch, useSession } from "@/lib/session";
import { initials } from "@/lib/format";
import { GUTTER, useTheme } from "@/theme";
import { SelectField } from "./Form";
import { type IconName } from "./Icon";
import { Row, Section } from "./List";
import { Text } from "./Text";

/** Round initials avatar. */
export function Avatar({ name, size = 40, gold }: { name: string | null | undefined; size?: number; gold?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2, borderCurve: "continuous",
        backgroundColor: gold ? c.goldBright : c.vault2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text variant={size >= 56 ? "title2" : "subhead"} weight="700" color={gold ? c.onGold : c.goldLight}>
        {initials(name)}
      </Text>
    </View>
  );
}

/**
 * Branch selector bound to a local value (screens that filter by branch).
 * `allowAll` adds "All branches" ("") for shop-wide roles only.
 */
export function BranchSelect({
  value,
  onChange,
  allowAll,
  label = "Branch",
}: {
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  label?: string;
}) {
  const b = useBranch();
  return (
    <SelectField
      label={label}
      value={value}
      options={b.branches.map((br) => ({ value: br.id, label: br.name, subtitle: br.code }))}
      onChange={(v) => onChange(v)}
      allowClear={allowAll && b.canShop}
      clearLabel="All branches"
      placeholder={allowAll && b.canShop ? "All branches" : "Select branch"}
    />
  );
}

export type ModuleLink = { href: string; label: string; icon: IconName; perm?: string; anyPerm?: string[]; subtitle?: string; color?: string };

/** Section of links to a module's pages, filtered by permission (web ModuleNav). */
export function ModuleLinks({ title = "Pages", links, style }: { title?: string; links: ModuleLink[]; style?: StyleProp<ViewStyle> }) {
  const { can, canAny } = useSession();
  const { c } = useTheme();
  const visible = links.filter((l) => (!l.perm && !l.anyPerm) || (l.perm && can(l.perm)) || (l.anyPerm && canAny(l.anyPerm)));
  if (visible.length === 0) return null;
  return (
    <Section title={title} style={style}>
      {visible.map((l) => (
        <Row key={l.href} title={l.label} subtitle={l.subtitle} icon={l.icon} iconColor={l.color ?? c.gold} href={l.href as Href} />
      ))}
    </Section>
  );
}

/** Spacer between stacked blocks on a screen. */
export function Gap({ h = 16 }: { h?: number }) {
  return <View style={{ height: h }} />;
}

/** Plain padded block aligned with grouped content. */
export function Inset({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ paddingHorizontal: GUTTER }, style]}>{children}</View>;
}

/** Shows children only when the user has the permission (or any of them). */
export function Can({ perm, any, children }: { perm?: string; any?: string[]; children: React.ReactNode }) {
  const { can, canAny } = useSession();
  const ok = (perm ? can(perm) : true) && (any ? canAny(any) : true);
  return ok ? <>{children}</> : null;
}

/** Numbered section heading for dashboards (web SectionHead): "01 Workspaces". */
export function SectionHeading({ index, title, subtitle }: { index?: string; title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ marginHorizontal: GUTTER, marginTop: 28, marginBottom: 2, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        {index ? (
          <Text variant="caption1" weight="700" num color={c.gold} style={{ letterSpacing: 1.6 }}>
            {index}
          </Text>
        ) : null}
        <Text variant="title3">{title}</Text>
      </View>
      {subtitle ? (
        <Text variant="footnote" tone="secondary">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
