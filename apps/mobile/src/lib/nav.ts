import { Platform } from "react-native";
import type { Palette } from "@/theme";

/**
 * Default native-stack options: iOS large titles over a translucent blurred
 * bar (content scrolls underneath), gold tint, minimal back button. On
 * Android a solid bar. Detail screens opt out of the large title with
 * `<Stack.Screen options={{ title, headerLargeTitleEnabled: false }} />`.
 */
export function stackOptions(c: Palette, dark: boolean) {
  const ios = Platform.OS === "ios";
  return {
    headerLargeTitleEnabled: ios,
    headerTransparent: ios,
    headerBlurEffect: ios ? (dark ? "systemChromeMaterialDark" : "systemChromeMaterial") : undefined,
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: !ios,
    headerLargeStyle: { backgroundColor: ios ? "transparent" : c.bg },
    headerStyle: ios ? undefined : { backgroundColor: c.bgElevated },
    headerTitleStyle: { color: c.label, fontFamily: "Inter_600SemiBold" },
    headerLargeTitleStyle: { color: c.label, fontFamily: "PlayfairDisplay_700Bold" },
    headerTintColor: c.gold,
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: c.bg },
  } as const;
}
