import { View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { stackOptions } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import { Button, ErrorState } from "@/ui";

/**
 * Everything behind sign-in. Module screens live beside the (tabs) group so
 * any tab can push them; they mirror the web routes (apps/web/app/(app)/…).
 */
export default function AppLayout() {
  const { c, dark } = useTheme();
  const { status, error, retry, signOut } = useSession();

  if (status === "loading") return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (status === "signedOut") return <Redirect href="/login" />;
  if (status === "error") {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: "center" }}>
        <ErrorState error={error} title="Can't reach GoldOS" onRetry={retry} />
        <Button title="Sign out" variant="plain" onPress={() => void signOut()} style={{ alignSelf: "center" }} />
      </View>
    );
  }

  return (
    <Stack screenOptions={stackOptions(c, dark)}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
