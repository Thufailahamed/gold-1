import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useHeaderHeight } from "expo-router/react-navigation";
import { router, type Href } from "expo-router";
import { api } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { GUTTER, radius, squircle, useTheme } from "@/theme";
import { BlurView } from "expo-blur";
import { Separator } from "./List";
import { PressableScale } from "./PressableScale";
import { EmptyState, ErrorState } from "./States";
import { Text } from "./Text";

type Refetchable = { refetch: () => Promise<unknown> };

/**
 * Pull-to-refresh wired to any number of react-query results:
 * `const refresh = useRefresh(a, b); <Screen {...refresh}>`.
 */
export function useRefresh(...queries: Refetchable[]) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptic.light();
    try {
      await Promise.all(queries.map((q) => q.refetch()));
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, queries);
  return { refreshing, onRefresh };
}

/**
 * Standard scrolling screen on the grouped background. Content flows under
 * the translucent iOS large-title header and tab bar
 * (contentInsetAdjustmentBehavior), and the keyboard pushes inputs into view.
 */
export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  style,
  contentStyle,
  footer,
  background,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pinned bar under the scroll view (e.g. a checkout button). */
  footer?: ReactNode;
  background?: string;
}) {
  const { c } = useTheme();
  const headerHeight = useSafeHeaderHeight();
  const bg = background ?? c.bg;
  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: bg, paddingTop: Platform.OS === "ios" ? headerHeight : 0 }, style]}>
        {children}
        {footer}
      </View>
    );
  }
  return (
    <View style={[{ flex: 1, backgroundColor: bg }, style]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[{ paddingBottom: footer ? 24 : 48 }, contentStyle]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.gold} colors={[c.gold]} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

/** Header height when inside a navigator, 0 otherwise (safe outside stacks). */
function useSafeHeaderHeight(): number {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useHeaderHeight();
  } catch {
    return 0;
  }
}

/**
 * A bar pinned to the bottom of a screen (checkout, save). On iOS it is a
 * frosted system material, like Apple's toolbars; elsewhere a solid surface.
 * Sits above the home indicator.
 */
export function BottomBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, dark } = useTheme();
  const ios = Platform.OS === "ios";
  const inner: ViewStyle = { paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: ios ? 34 : 16, gap: 10 };
  if (ios) {
    return (
      <BlurView
        intensity={100}
        tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
        style={[{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }, inner, style]}
      >
        {children}
      </BlurView>
    );
  }
  return <View style={[{ backgroundColor: c.bgElevated, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }, inner, style]}>{children}</View>;
}

export type Paged<T> = { rows: T[]; total: number };

/**
 * Infinite list over the API's `{ rows, total }` + `page`/`limit` convention.
 * `path(page)` must return the full path including `page` and `limit`.
 */
export function usePagedQuery<T>(queryKey: QueryKey, path: (page: number) => string, opts?: { enabled?: boolean; limit?: number }) {
  const limit = opts?.limit ?? 30;
  const q = useInfiniteQuery({
    queryKey,
    enabled: opts?.enabled ?? true,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Paged<T>>(path(pageParam)),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total && last.rows.length > 0 ? all.length + 1 : undefined;
    },
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  return { ...q, rows, total, limit };
}

/**
 * Full-screen list rendered as one inset-grouped card (rows separated by
 * hairlines), with header content above, pull-to-refresh, infinite scroll and
 * empty/error states. Pass a `usePagedQuery` result as `query`, or plain
 * `data` + `loading`.
 */
export function ScreenList<T>({
  data,
  query,
  renderItem,
  keyExtractor,
  header,
  footer,
  empty,
  loading,
  error,
  onRetry,
  refreshing,
  onRefresh,
  grouped = true,
  separatorIndent = 16,
  ...rest
}: {
  data?: T[];
  query?: ReturnType<typeof usePagedQuery<T>>;
  renderItem: (item: T, index: number) => ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  empty?: { icon?: Parameters<typeof EmptyState>[0]["icon"]; title: string; message?: string; action?: Parameters<typeof EmptyState>[0]["action"] };
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  grouped?: boolean;
  separatorIndent?: number;
} & Omit<FlatListProps<T>, "data" | "renderItem" | "keyExtractor" | "ListHeaderComponent" | "ListFooterComponent" | "ListEmptyComponent" | "refreshing" | "onRefresh">) {
  const { c } = useTheme();
  const items = query ? query.rows : data ?? [];
  const isLoading = query ? query.isLoading : !!loading;
  const err = query ? query.error : error;
  const [pulling, setPulling] = useState(false);
  const doRefresh =
    onRefresh ??
    (query
      ? async () => {
          setPulling(true);
          try {
            await query.refetch();
          } finally {
            setPulling(false);
          }
        }
      : undefined);
  const n = items.length;
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: 48 }}
      data={items}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => {
        const el = renderItem(item, index);
        if (!grouped) return el;
        return (
          <View
            style={{
              marginHorizontal: GUTTER,
              backgroundColor: c.card,
              borderTopLeftRadius: index === 0 ? radius.lg - 2 : 0,
              borderTopRightRadius: index === 0 ? radius.lg - 2 : 0,
              borderBottomLeftRadius: index === n - 1 ? radius.lg - 2 : 0,
              borderBottomRightRadius: index === n - 1 ? radius.lg - 2 : 0,
              ...squircle,
              overflow: "hidden",
            }}
          >
            {index > 0 ? <Separator indent={separatorIndent} /> : null}
            {el}
          </View>
        );
      }}
      ListHeaderComponent={
        <View style={{ paddingBottom: n > 0 ? 12 : 0 }}>
          {header}
        </View>
      }
      ListEmptyComponent={
        isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={c.gold} />
          </View>
        ) : err ? (
          <ErrorState error={err} onRetry={onRetry ?? (query ? () => void query.refetch() : undefined)} />
        ) : empty ? (
          <EmptyState icon={empty.icon} title={empty.title} message={empty.message} action={empty.action} />
        ) : null
      }
      ListFooterComponent={
        <View>
          {query?.isFetchingNextPage ? (
            <View style={{ paddingVertical: 20 }}>
              <ActivityIndicator color={c.gold} />
            </View>
          ) : null}
          {footer}
        </View>
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (query?.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      refreshControl={
        doRefresh ? (
          <RefreshControl refreshing={refreshing ?? pulling} onRefresh={doRefresh} tintColor={c.gold} colors={[c.gold]} />
        ) : undefined
      }
      {...rest}
    />
  );
}

/** Horizontal scrolling chips for filters / module sub-pages. */
export function Chips<K extends string>({
  items,
  value,
  onChange,
  style,
}: {
  items: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 8 }} style={[{ flexGrow: 0 }, style]}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <PressableScale
            key={it.key}
            scaleTo={0.94}
            onPress={() => {
              haptic.selection();
              onChange(it.key);
            }}
            style={{
              paddingHorizontal: 14,
              height: 34,
              borderRadius: 17, borderCurve: "continuous",
              justifyContent: "center",
              backgroundColor: active ? c.label : c.card,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderWidth: active ? 0 : StyleSheet.hairlineWidth,
              borderColor: c.hairline,
            }}
          >
            <ChipText active={active}>{it.label}</ChipText>
            {it.count !== undefined ? <ChipText active={active} dim>{String(it.count)}</ChipText> : null}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

function ChipText({ children, active, dim }: { children: string; active: boolean; dim?: boolean }) {
  const { c } = useTheme();
  return (
    <Text variant="subhead" weight="600" num color={active ? c.bg : dim ? c.label3 : c.label}>
      {children}
    </Text>
  );
}

/** Links to a module's sub-pages as a horizontal pill nav (web ModuleNav). */
export function ModuleTabs({ pages, current }: { pages: { href: string; label: string }[]; current: string }) {
  return (
    <Chips
      items={pages.map((p) => ({ key: p.href, label: p.label }))}
      value={current}
      onChange={(href) => {
        if (href !== current) router.push(href as Href);
      }}
      style={{ marginTop: 8 }}
    />
  );
}
