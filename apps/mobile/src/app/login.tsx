import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loginSchema } from "@goldos/shared";
import { errorMessage } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { radius, squircle, useTheme } from "@/theme";
import { Button, Field, GoldGlow, Icon, Kicker, Text, type IconName } from "@/ui";

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: "coins", label: "Live rates" },
  { icon: "barcode", label: "Barcode-first" },
  { icon: "shield", label: "Audited" },
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0B0A08" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      {/* Full-bleed vault backdrop */}
      <LinearGradient colors={["#3A2D0E", "#14110B", "#0B0A08"]} locations={[0, 0.45, 1]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <GoldGlow size={520} top={-260} right={-200} opacity={0.6} />
      <GoldGlow size={360} top={240} right={180} opacity={0.14} />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} bounces={false} showsVerticalScrollIndicator={false}>
        {/* Brand */}
        <View style={[styles.brand, { paddingTop: insets.top + 28 }]}>
          <View style={styles.logoHalo}>
            <LinearGradient colors={["#FFF4C7", "#E7C65A", "#A8861B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
              <LinearGradient colors={["rgba(255,255,255,0.45)", "rgba(255,255,255,0)"]} style={styles.logoSheen} />
              <Icon name="gem" size={30} color="#1C1917" weight="semibold" />
            </LinearGradient>
          </View>

          <Text tone="onVault" display weight="700" center style={{ fontSize: 46, lineHeight: 54, marginTop: 22 }}>
            Gold<Text display weight="700" color="#E7C65A" style={{ fontSize: 46, lineHeight: 54 }}>OS</Text>
          </Text>
          <View style={styles.kickerRow}>
            <View style={styles.rule} />
            <Kicker style={{ color: "rgba(243,217,122,0.9)", letterSpacing: 2.2 }}>Jewellery ERP · Sri Lanka</Kicker>
            <View style={styles.rule} />
          </View>
          <Text variant="subhead" tone="onVault2" center style={{ marginTop: 16, maxWidth: 300, lineHeight: 22 }}>
            Catalog, barcodes, live board rates and branch inventory — one workspace for every counter.
          </Text>

          <View style={styles.chips}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.chip}>
                <Icon name={f.icon} size={12} color="#F3D97A" weight="semibold" />
                <Text variant="caption1" weight="600" color="rgba(255,255,255,0.85)">
                  {f.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Sign-in sheet */}
        <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 16 }]}>
          <LinearGradient
            colors={["transparent", "rgba(231,198,90,0.7)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.sheetHairline}
          />
          <View style={{ gap: 6, marginBottom: 6 }}>
            <Kicker tone="gold" style={{ letterSpacing: 1.6 }}>
              Branch sign in
            </Kicker>
            <Text variant="title1" display weight="700">
              Welcome back
            </Text>
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
            placeholder="Enter your password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            error={errors.password}
            icon="lock"
          />
          {errors.form ? (
            <View style={[styles.formError, { backgroundColor: `${c.red}14`, borderColor: `${c.red}33` }]}>
              <Icon name="alert" size={16} color={c.red} />
              <Text variant="footnote" tone="danger" style={{ flex: 1 }}>
                {errors.form}
              </Text>
            </View>
          ) : null}
          <View style={styles.btnShadow}>
            <Button title={pending ? "Signing in…" : "Sign in"} iconRight={pending ? undefined : "arrowRight"} size="lg" onPress={onSubmit} loading={pending} block />
          </View>
          <View style={styles.secure}>
            <Icon name="lock" size={10} color={c.green} />
            <Text variant="caption2" tone="tertiary" weight="600" upper style={{ letterSpacing: 1.2 }}>
              Encrypted session · Audit logged
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, paddingBottom: 36 },
  logoHalo: {
    padding: 6,
    borderRadius: 30,
    ...squircle,
    backgroundColor: "rgba(231,198,90,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(231,198,90,0.35)",
    shadowColor: "#E7C65A",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  logo: { width: 72, height: 72, borderRadius: 24, ...squircle, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoSheen: { position: "absolute", top: 0, left: 0, right: 0, height: "55%" },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  rule: { width: 22, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(231,198,90,0.6)" },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 22 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  sheet: {
    borderTopLeftRadius: radius.xxl + 4,
    borderTopRightRadius: radius.xxl + 4,
    ...squircle,
    paddingHorizontal: 22,
    paddingTop: 30,
    gap: 16,
    overflow: "hidden",
  },
  sheetHairline: { position: "absolute", top: 0, left: 40, right: 40, height: 1 },
  btnShadow: {
    marginTop: 6,
    borderRadius: 16,
    shadowColor: "#B8901C",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  formError: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, ...squircle, borderWidth: StyleSheet.hairlineWidth },
  secure: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 4 },
});
