import { Stack } from "expo-router";
import { stackOptions } from "@/lib/nav";
import { useTheme } from "@/theme";

export default function ScanTabLayout() {
  const { c, dark } = useTheme();
  return (
    <Stack screenOptions={stackOptions(c, dark)}>
      <Stack.Screen name="index" options={{ title: "Scan" }} />
    </Stack>
  );
}
