import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from "react-native";
import { router, type Href } from "expo-router";
import { haptic } from "@/lib/haptics";
import { elevation, GUTTER, radius, squircle, useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

/**
 * iOS inset-grouped list section: optional uppercase header, rounded card of
 * rows separated by inset hairlines, optional footer note. Children can be
 * any views; separators are inserted between direct children automatically.
 */
export function Section({
  title,
  footer,
  action,
  children,
  inset = true,
  style,
  separators = true,
}: {
  title?: string;
  footer?: ReactNode;
  /** Right-aligned header accessory (e.g. "See all"). */
  action?: { label: string; onPress: () => void };
  children?: ReactNode;
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
  separators?: boolean;
}) {
  const { c, dark } = useTheme();
  const items = Children.toArray(children).filter((ch) => isValidElement(ch));
  const r = inset ? radius.xl - 4 : 0;
  return (
    <View style={[{ marginTop: title ? 22 : 18, marginHorizontal: inset ? GUTTER : 0 }, style]}>
      {title || action ? (
        <View style={styles.header}>
          <Text variant="caption1" tone="secondary" weight="600" upper style={{ letterSpacing: 0.9, flex: 1 }} numberOfLines={1}>
            {title ?? ""}
          </Text>
          {action ? (
            <Pressable hitSlop={8} onPress={action.onPress}>
              {({ pressed }) => (
                <Text variant="footnote" color={c.gold} weight="600" style={{ opacity: pressed ? 0.5 : 1 }}>
                  {action.label}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {items.length > 0 ? (
        <View style={[{ backgroundColor: c.card, borderRadius: r, ...squircle }, inset && !dark ? elevation.card : null]}>
          <View
            style={{
              borderRadius: r,
              ...squircle,
              overflow: "hidden",
              borderWidth: inset ? StyleSheet.hairlineWidth : 0,
              borderColor: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            }}
          >
            {items.map((child, i) => (
              <Fragment key={(isValidElement(child) && child.key) || i}>
                {i > 0 && separators ? <Separator /> : null}
                {child}
              </Fragment>
            ))}
          </View>
        </View>
      ) : null}
      {footer ? (
        typeof footer === "string" ? (
          <Text variant="footnote" tone="secondary" style={styles.footer}>
            {footer}
          </Text>
        ) : (
          <View style={styles.footer}>{footer}</View>
        )
      ) : null}
    </View>
  );
}

export function Separator({ indent = 16 }: { indent?: number }) {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: indent }} />;
}

/** Coloured rounded-square glyph used at the start of rows (Settings style). */
export function IconTile({ name, color, size = 30, glyph }: { name: IconName; color?: string; size?: number; glyph?: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        ...squircle,
        backgroundColor: color ?? c.gold,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={name} size={size * 0.56} color={glyph ?? "#FFFFFF"} weight="semibold" />
    </View>
  );
}

/**
 * A list row. Give `href` or `onPress` to make it tappable (adds a chevron).
 * `value` renders right-aligned secondary text (tabular figures);
 * `right` replaces it with any element.
 */
export function Row({
  title,
  subtitle,
  value,
  valueTone,
  icon,
  iconColor,
  leading,
  right,
  href,
  onPress,
  onLongPress,
  chevron,
  destructive,
  disabled,
  selected,
  numberOfLines = 1,
  mono,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  valueTone?: "secondary" | "label" | "success" | "danger" | "warning" | "gold";
  icon?: IconName;
  iconColor?: string;
  leading?: ReactNode;
  right?: ReactNode;
  href?: Href;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Shows a checkmark (selection lists). */
  selected?: boolean;
  numberOfLines?: number;
  /** Monospace subtitle (codes, SKUs). */
  mono?: boolean;
}) {
  const { c } = useTheme();
  const tappable = !!(href || onPress) && !disabled;
  const showChevron = chevron ?? (tappable && selected === undefined);
  const body = (pressed: boolean) => (
    <View style={[styles.row, { backgroundColor: pressed ? c.highlight : "transparent", opacity: disabled ? 0.45 : 1 }]}>
      {leading ?? (icon ? <IconTile name={icon} color={iconColor} /> : null)}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        {typeof title === "string" ? (
          <Text variant="body" numberOfLines={numberOfLines} color={destructive ? c.red : undefined}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === "string" ? (
            <Text variant="footnote" tone="secondary" numberOfLines={2} mono={mono}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {right ??
        (value !== undefined && value !== null ? (
          typeof value === "string" || typeof value === "number" ? (
            <Text
              variant="body"
              tone={valueTone ?? "secondary"}
              weight={valueTone && valueTone !== "secondary" ? "600" : undefined}
              num
              numberOfLines={1}
              style={{ maxWidth: "55%", flexShrink: 1 }}
            >
              {value}
            </Text>
          ) : (
            value
          )
        ) : null)}
      {selected ? <Icon name="check" size={17} color={c.gold} weight="bold" /> : null}
      {showChevron ? <Icon name="chevronRight" size={13} color={c.label3} weight="bold" /> : null}
    </View>
  );
  if (!tappable) return body(false);
  return (
    <Pressable
      accessibilityRole="button"
      onLongPress={onLongPress}
      onPress={() => {
        haptic.selection();
        if (onPress) onPress();
        else if (href) router.push(href);
      }}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

/** Label/value pair stacked for detail sheets ("Net weight · 12.345 g"). */
export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {typeof value === "string" || typeof value === "number" ? (
          <Text variant="body" num mono={mono} right numberOfLines={2}>
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
    </View>
  );
}

export function SwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
  icon,
  iconColor,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  icon?: IconName;
  iconColor?: string;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Row
      title={title}
      subtitle={subtitle}
      icon={icon}
      iconColor={iconColor}
      disabled={disabled}
      right={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            haptic.selection();
            onValueChange(v);
          }}
          trackColor={{ true: c.green, false: c.fillStrong }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, paddingBottom: 7, gap: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingVertical: 10, paddingHorizontal: 16 },
});
