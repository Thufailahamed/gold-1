import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { Text } from "./Text";
import { ToastViewport } from "./Toast";

/**
 * Native iOS page sheet (card that slides up, swipe to dismiss) with the
 * standard Cancel · Title · Done bar. Used for every create/edit form.
 * On Android it presents full-screen with the same bar.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  submitLabel = "Done",
  onSubmit,
  submitting,
  canSubmit = true,
  cancelLabel = "Cancel",
  scroll = true,
  destructive,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  submitLabel?: string;
  onSubmit?: () => void;
  submitting?: boolean;
  canSubmit?: boolean;
  cancelLabel?: string;
  scroll?: boolean;
  destructive?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const ios = Platform.OS === "ios";
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={ios ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
      statusBarTranslucent={!ios}
    >
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: ios ? 0 : insets.top }}>
        <View style={[styles.bar, { borderBottomColor: c.hairline, backgroundColor: c.bg }]}>
          <Pressable hitSlop={10} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, minWidth: 70 })}>
            <Text variant="body" color={c.gold}>
              {cancelLabel}
            </Text>
          </Pressable>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: "center" }}>
            {title}
          </Text>
          <View style={{ minWidth: 70, alignItems: "flex-end" }}>
            {onSubmit ? (
              submitting ? (
                <ActivityIndicator color={c.gold} />
              ) : (
                <Pressable
                  hitSlop={10}
                  disabled={!canSubmit}
                  onPress={onSubmit}
                  style={({ pressed }) => ({ opacity: !canSubmit ? 0.35 : pressed ? 0.5 : 1 })}
                >
                  <Text variant="body" weight="600" color={destructive ? c.red : c.gold}>
                    {submitLabel}
                  </Text>
                </Pressable>
              )
            ) : null}
          </View>
        </View>
        {scroll ? (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
        <ToastViewport />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
