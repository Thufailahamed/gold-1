import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const safe = (fn: () => Promise<void>) => {
  if (Platform.OS === "web") return;
  fn().catch(() => undefined);
};

/** Tactile feedback, used sparingly the way iOS does. */
export const haptic = {
  /** Toggles, segment changes, picker ticks. */
  selection: () => safe(() => Haptics.selectionAsync()),
  /** Button taps that commit something small (add to cart). */
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
