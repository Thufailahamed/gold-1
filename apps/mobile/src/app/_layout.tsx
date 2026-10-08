import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Inter_300Light } from "@expo-google-fonts/inter/300Light";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { Inter_900Black } from "@expo-google-fonts/inter/900Black";
import { PlayfairDisplay_500Medium } from "@expo-google-fonts/playfair-display/500Medium";
import { PlayfairDisplay_600SemiBold } from "@expo-google-fonts/playfair-display/600SemiBold";
import { PlayfairDisplay_700Bold } from "@expo-google-fonts/playfair-display/700Bold";
import { PlayfairDisplay_800ExtraBold } from "@expo-google-fonts/playfair-display/800ExtraBold";
import { StatusBar } from "expo-status-bar";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import { PromptHost, ScannerHost, ToastViewport } from "@/ui";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, err) => {
        const code = (err as { code?: string } | null)?.code;
        if (code && ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "VALIDATION"].includes(code)) return false;
        return n < 2;
      },
    },
  },
});

// Refetch stale data when the app comes back to the foreground.
function useAppFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (Platform.OS !== "web") focusManager.setFocused(s === "active");
    });
    return () => sub.remove();
  }, []);
}

function Root() {
  const { c, dark } = useTheme();
  const { status } = useSession();
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_800ExtraBold,
  });
  const fontsReady = fontsLoaded || !!fontError;
  useAppFocus();

  useEffect(() => {
    if (status !== "loading" && fontsReady) SplashScreen.hideAsync().catch(() => undefined);
  }, [status, fontsReady]);

  if (!fontsReady) return null;

  const nav = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...nav,
        colors: { ...nav.colors, primary: c.gold, background: c.bg, card: c.bgElevated, text: c.label, border: c.separator },
      }}
    >
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="login" options={{ animation: "fade" }} />
        <Stack.Screen name="(app)" options={{ animation: "fade" }} />
      </Stack>
      <ScannerHost />
      <PromptHost />
      <ToastViewport />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
