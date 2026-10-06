import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loginSchema } from "@goldos/shared";
import { errorMessage } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import { Button, Field, GoldGlow, Icon, Kicker, Text } from "@/ui";

const FEATURES = [
  "Live per-karat pricing on every piece",
  "Barcode-first catalog and stock movements",
  "Role-based access with full audit trail",
];

export default function LoginScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const pwRef = useRef<TextInput>(null);

  if (status === "signedIn") return <Redirect href="/home" />;

  async function onSubmit() {
    const parsed = loginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({
        email: f.email ? "Enter a valid email address" : undefined,
        password: f.password ? "Password must be at least 8 characters" : undefined,
      });
      haptic.error();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      haptic.success();
      router.replace("/home");
    } catch (err) {
      haptic.error();
      setErrors({ form: errorMessage(err, "Sign in failed") });
    } finally {
      setPending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} bounces={false}>
        {/* Brand */}
        <View style={[styles.hero, { paddingTop: insets.top + 36, backgroundColor: c.vault }]}>
          <LinearGradient colors={["#2A2110", "#0C0A09"]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
          <GoldGlow size={420} top={-200} right={-160} opacity={0.55} />
          <GoldGlow size={300} top={160} right={220} opacity={0.18} />
          <LinearGradient colors={["#FFF4C7", "#E7C65A", "#A8861B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
            <Icon name="gem" size={28} color="#1C1917" weight="semibold" />
          </LinearGradient>
          <Text variant="largeTitle" tone="onVault" style={{ marginTop: 18, letterSpacing: -0.6 }}>
            Gold<Text variant="largeTitle" color="#E7C65A">OS</Text>
          </Text>
          <Kicker style={{ color: "#E7C65A", marginTop: 6 }}>Jewellery ERP · Sri Lanka</Kicker>
          <Text variant="subhead" tone="onVault2" style={{ marginTop: 14, maxWidth: 320 }}>
            Catalog, barcodes, live board rates and branch inventory — one workspace for every counter.
          </Text>
          <View style={{ marginTop: 20, gap: 9 }}>
            {FEATURES.map((f) => (
              <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                <Icon name="checkCircle" size={15} color="#E7C65A" />
                <Text variant="footnote" tone="onVault2">
                  {f}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Form */}
        <View style={{ padding: 20, gap: 16, flex: 1 }}>
          <View style={{ gap: 4, marginTop: 6 }}>
            <Kicker tone="gold">Branch sign in</Kicker>
            <Text variant="title1">Welcome back</Text>
            <Text variant="subhead" tone="secondary">
              Use your branch credentials to continue.
            </Text>
          </View>
          <Field
            label="Email"
            kind="email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@branch.lk"
            autoComplete="username"
            returnKeyType="next"
            onSubmitEditing={() => pwRef.current?.focus()}
            error={errors.email}
            icon="mail"
          />
          <Field
            ref={pwRef}
            label="Password"
            kind="password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            error={errors.password}
            icon="lock"
          />
          {errors.form ? (
            <View style={[styles.formError, { backgroundColor: "rgba(255,59,48,0.1)" }]}>
              <Icon name="alert" size={16} color={c.red} />
              <Text variant="footnote" tone="danger" style={{ flex: 1 }}>
                {errors.form}
              </Text>
            </View>
          ) : null}
          <Button title={pending ? "Signing in…" : "Sign in"} iconRight={pending ? undefined : "arrowRight"} size="lg" onPress={onSubmit} loading={pending} block />
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingBottom: insets.bottom + 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: c.green }} />
            <Text variant="caption2" tone="tertiary" upper style={{ letterSpacing: 1.4 }}>
              Encrypted session · Audit logged
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 24, paddingBottom: 30, overflow: "hidden", borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  logo: { width: 60, height: 60, borderRadius: 18, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  formError: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 , borderCurve: "continuous"},
});
