import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { haptic } from "@/lib/haptics";
import { isoDate } from "@/lib/format";
import { GUTTER, radius, squircle, typeScale, useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { Row, Section } from "./List";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

/**
 * Labelled text input on a rounded fill (label above, error below).
 * Use `kind` for the right keyboard: "money" (2 dp), "weight" (3 dp grams),
 * "int", "email", "phone", "password".
 */
export const Field = forwardRef<
  TextInput,
  Omit<TextInputProps, "onChange"> & {
    label?: string;
    hint?: string;
    error?: string | null;
    kind?: "text" | "money" | "weight" | "int" | "decimal" | "email" | "phone" | "password" | "code";
    prefix?: string;
    suffix?: string;
    icon?: IconName;
    containerStyle?: StyleProp<ViewStyle>;
    right?: ReactNode;
    multiline?: boolean;
  }
>(function Field({ label, hint, error, kind = "text", prefix, suffix, icon, containerStyle, right, multiline, style, onFocus, onBlur, ...rest }, ref) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const keyboard: TextInputProps["keyboardType"] =
    kind === "money" || kind === "weight" || kind === "decimal"
      ? "decimal-pad"
      : kind === "int"
        ? "number-pad"
        : kind === "email"
          ? "email-address"
          : kind === "phone"
            ? "phone-pad"
            : "default";
  const numeric = kind === "money" || kind === "weight" || kind === "int" || kind === "decimal";
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? (
        <Text variant="footnote" tone="secondary" weight="500" style={{ paddingHorizontal: 4 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          backgroundColor: c.card,
          borderRadius: radius.md + 2,
          ...squircle,
          paddingHorizontal: 14,
          minHeight: multiline ? 96 : 48,
          gap: 8,
          borderWidth: 1.5,
          borderColor: error ? c.red : focused ? c.gold : "transparent",
        }}
      >
        {icon ? <Icon name={icon} size={17} color={c.label2} /> : null}
        {prefix ? (
          <Text variant="body" tone="secondary">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.label3}
          selectionColor={c.gold}
          keyboardType={keyboard}
          autoCapitalize={kind === "email" || kind === "password" || kind === "code" ? "none" : rest.autoCapitalize}
          autoCorrect={kind === "text" && !numeric ? rest.autoCorrect : false}
          secureTextEntry={kind === "password" && !reveal}
          textContentType={kind === "email" ? "emailAddress" : kind === "password" ? "password" : rest.textContentType}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            typeScale.body,
            {
              flex: 1,
              color: c.label,
              paddingVertical: multiline ? 12 : Platform.OS === "android" ? 8 : 12,
              fontVariant: numeric ? ["tabular-nums"] : undefined,
              textAlignVertical: multiline ? "top" : "center",
              minHeight: multiline ? 90 : undefined,
            },
            style,
          ]}
          {...rest}
        />
        {suffix ? (
          <Text variant="body" tone="secondary">
            {suffix}
          </Text>
        ) : null}
        {kind === "password" ? (
          <Pressable hitSlop={10} onPress={() => setReveal((v) => !v)} accessibilityLabel={reveal ? "Hide password" : "Show password"}>
            <Icon name={reveal ? "eyeOff" : "eye"} size={18} color={c.label2} />
          </Pressable>
        ) : null}
        {right}
      </View>
      {error ? (
        <Text variant="footnote" tone="danger" style={{ paddingHorizontal: 4 }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: 4 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/** Vertical stack of fields with standard gutters, for forms inside a Sheet or Screen. */
export function FormStack({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ paddingHorizontal: GUTTER, paddingTop: 18, gap: 16 }, style]}>{children}</View>;
}

/** Two fields side by side. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 12 }}>{Array.isArray(children) ? children.map((ch, i) => <View key={i} style={{ flex: 1 }}>{ch}</View>) : children}</View>;
}

/** iOS search field. */
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search",
  onSubmit,
  autoFocus,
  style,
  right,
}: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={[{ marginHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: 8 }, style]}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: c.fill, borderRadius: 10, borderCurve: "continuous", paddingHorizontal: 8, height: 38, gap: 6 }}>
        <Icon name="search" size={16} color={c.label2} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.label2}
          selectionColor={c.gold}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus={autoFocus}
          onSubmitEditing={onSubmit}
          style={[typeScale.body, { flex: 1, color: c.label, paddingVertical: 0 }]}
        />
        {value ? (
          <Pressable hitSlop={8} onPress={() => onChangeText("")} accessibilityLabel="Clear search">
            <Icon name="closeCircle" size={16} color={c.label3} />
          </Pressable>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export type Option<V extends string = string> = { value: V; label: string; subtitle?: string };

/**
 * Tappable field that opens a searchable option sheet (replaces <select>).
 * `allowClear` adds a "None" option that sets "".
 */
export function SelectField<V extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  allowClear,
  clearLabel = "None",
  error,
  hint,
  disabled,
  title,
}: {
  label?: string;
  value: V | "" | null | undefined;
  options: Option<V>[];
  onChange: (v: V | "") => void;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="footnote" tone="secondary" weight="500" style={{ paddingHorizontal: 4 }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        disabled={disabled}
        onPress={() => {
          haptic.selection();
          setOpen(true);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.card,
          borderRadius: radius.md + 2,
          ...squircle,
          paddingHorizontal: 14,
          minHeight: 48,
          gap: 8,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
          borderWidth: 1.5,
          borderColor: error ? c.red : "transparent",
        })}
      >
        <Text variant="body" tone={current ? "label" : "tertiary"} numberOfLines={1} style={{ flex: 1 }}>
          {current?.label ?? (value === "" && allowClear && !placeholder ? clearLabel : placeholder)}
        </Text>
        <Icon name="chevronDown" size={13} color={c.label2} weight="bold" />
      </Pressable>
      {error ? (
        <Text variant="footnote" tone="danger" style={{ paddingHorizontal: 4 }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: 4 }}>
          {hint}
        </Text>
      ) : null}
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={title ?? label ?? "Select"}
        options={options}
        value={value ?? ""}
        allowClear={allowClear}
        clearLabel={clearLabel}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </View>
  );
}

/** The picker sheet behind SelectField; usable directly for action-style pickers. */
export function OptionSheet<V extends string>({
  visible,
  onClose,
  title,
  options,
  value,
  onPick,
  allowClear,
  clearLabel = "None",
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: Option<V>[];
  value: string;
  onPick: (v: V | "") => void;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s) || (o.subtitle ?? "").toLowerCase().includes(s));
  }, [options, q]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {options.length > 8 ? <SearchField value={q} onChangeText={setQ} style={{ marginTop: 12 }} /> : null}
      <Section>
        {allowClear ? <Row title={clearLabel} selected={value === ""} onPress={() => onPick("")} /> : null}
        {filtered.map((o) => (
          <Row key={o.value} title={o.label} subtitle={o.subtitle} selected={o.value === value} onPress={() => onPick(o.value)} />
        ))}
      </Section>
      {filtered.length === 0 && !allowClear ? (
        <Text variant="subhead" tone="secondary" center style={{ marginTop: 24 }}>
          No options
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Apple segmented control: the selected thumb slides between segments. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const x = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: index, useNativeDriver: true, speed: 18, bounciness: 4 }).start();
  }, [index, x]);
  const seg = width > 0 ? (width - 4) / options.length : 0;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: "row", backgroundColor: c.fill, borderRadius: 9, ...squircle, padding: 2, marginHorizontal: GUTTER }, style]}
    >
      {seg > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 2,
            bottom: 2,
            left: 2,
            width: seg,
            borderRadius: 7,
            ...squircle,
            backgroundColor: dark ? "#636366" : "#FFFFFF",
            shadowColor: "#000",
            shadowOpacity: 0.12,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
            transform: [{ translateX: x.interpolate({ inputRange: [0, Math.max(1, options.length - 1)], outputRange: [0, seg * Math.max(1, options.length - 1)] }) }],
          }}
        />
      ) : null}
      {options.map((o, i) => {
        const active = i === index;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) haptic.selection();
              onChange(o.key);
            }}
            style={{ flex: 1, height: 30, alignItems: "center", justifyContent: "center" }}
          >
            <Text variant="footnote" weight={active ? "600" : "500"} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
};

/**
 * Date input bound to a "YYYY-MM-DD" string. iOS shows the compact native
 * picker inline; Android opens the system date dialog.
 */
export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  allowClear,
  placeholder = "Select date",
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  allowClear?: boolean;
  placeholder?: string;
  error?: string | null;
}) {
  const { c, dark } = useTheme();
  const ios = Platform.OS === "ios";
  const date = value ? parseISO(value) : new Date();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="footnote" tone="secondary" weight="500" style={{ paddingHorizontal: 4 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.card,
          borderRadius: radius.md + 2,
          ...squircle,
          paddingHorizontal: 14,
          minHeight: 48,
          gap: 8,
          borderWidth: 1.5,
          borderColor: error ? c.red : "transparent",
        }}
      >
        <Icon name="calendar" size={17} color={c.label2} />
        {ios && value ? (
          <View style={{ flex: 1, alignItems: "flex-start" }}>
            <DateTimePicker
              value={date}
              mode="date"
              display="compact"
              accentColor={c.gold}
              themeVariant={dark ? "dark" : "light"}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onChange={(_, d) => d && onChange(isoDate(d))}
              style={{ marginLeft: -8 }}
            />
          </View>
        ) : (
          <Pressable
            style={{ flex: 1, paddingVertical: 12 }}
            onPress={() => {
              if (ios) {
                onChange(isoDate(new Date()));
                return;
              }
              DateTimePickerAndroid.open({
                value: date,
                mode: "date",
                minimumDate,
                maximumDate,
                onChange: (e, d) => {
                  if (e.type === "set" && d) onChange(isoDate(d));
                },
              });
            }}
          >
            <Text variant="body" tone={value ? "label" : "tertiary"}>
              {value ? parseISO(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : placeholder}
            </Text>
          </Pressable>
        )}
        {allowClear && value ? (
          <Pressable hitSlop={10} onPress={() => onChange("")} accessibilityLabel="Clear date">
            <Icon name="closeCircle" size={17} color={c.label3} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="footnote" tone="danger" style={{ paddingHorizontal: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Date + time picker; the value is epoch milliseconds (web datetime-local). */
export function DateTimeField({ label, value, onChange, error }: { label?: string; value: number; onChange: (ms: number) => void; error?: string | null }) {
  const { c, dark } = useTheme();
  const ios = Platform.OS === "ios";
  const d = new Date(value);
  const openAndroid = (mode: "date" | "time") =>
    DateTimePickerAndroid.open({
      value: d,
      mode,
      is24Hour: true,
      onChange: (e, nd) => {
        if (e.type !== "set" || !nd) return;
        const next = new Date(d);
        if (mode === "date") next.setFullYear(nd.getFullYear(), nd.getMonth(), nd.getDate());
        else next.setHours(nd.getHours(), nd.getMinutes(), 0, 0);
        onChange(next.getTime());
      },
    });
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="footnote" tone="secondary" weight="500" style={{ paddingHorizontal: 4 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.card,
          borderRadius: radius.md + 2,
          ...squircle,
          paddingHorizontal: 14,
          minHeight: 48,
          gap: 8,
          borderWidth: 1.5,
          borderColor: error ? c.red : "transparent",
        }}
      >
        <Icon name="clock" size={17} color={c.label2} />
        {ios ? (
          <View style={{ flex: 1, alignItems: "flex-start" }}>
            <DateTimePicker value={d} mode="datetime" display="compact" accentColor={c.gold} themeVariant={dark ? "dark" : "light"} onChange={(_, nd) => nd && onChange(nd.getTime())} style={{ marginLeft: -8 }} />
          </View>
        ) : (
          <View style={{ flex: 1, flexDirection: "row", gap: 16 }}>
            <Pressable style={{ paddingVertical: 12 }} onPress={() => openAndroid("date")}>
              <Text variant="body">{d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Text>
            </Pressable>
            <Pressable style={{ paddingVertical: 12 }} onPress={() => openAndroid("time")}>
              <Text variant="body">{d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</Text>
            </Pressable>
          </View>
        )}
      </View>
      {error ? (
        <Text variant="footnote" tone="danger" style={{ paddingHorizontal: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Small checkbox row for inline forms. */
export function Checkbox({ checked, onChange, label, subtitle }: { checked: boolean; onChange: (v: boolean) => void; label: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onChange(!checked);
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11, borderCurve: "continuous",
          borderWidth: checked ? 0 : 1.5,
          borderColor: c.label3,
          backgroundColor: checked ? c.gold : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="check" size={13} color="#FFFFFF" weight="bold" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  hairline: { height: StyleSheet.hairlineWidth },
});
