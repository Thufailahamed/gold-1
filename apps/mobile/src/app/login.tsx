import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Redirect, router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shopLookupSchema } from "@goldos/shared";
import { errorMessage, lookupShops, type ShopLookupItem } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { radius, squircle, useTheme } from "@/theme";
import { Button, Field, GoldGlow, Icon, Kicker, Text, type IconName } from "@/ui";

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: "coins", label: "Live rates" },
  { icon: "barcode", label: "Barcode-first" },
  { icon: "shield", label: "Audited" },
];

const SAVED_EMAIL_KEY = "goldos.saved_email";

export default function LoginScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, signIn, tenantSlug: savedTenantSlug } = useSession();
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [slug, setSlug] = useState("");
  const [shops, setShops] = useState<ShopLookupItem[] | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const pwRef = useRef<TextInput>(null);

  useEffect(() => {
    void SecureStore.getItemAsync(SAVED_EMAIL_KEY)
      .then((saved) => {
        if (saved) setEmail(saved);
      })
      .catch(() => undefined);
  }, []);

  if (status === "signedIn") return <Redirect href="/home" />;

  async function onContinueEmail() {
    let trimmed = email.trim().toLowerCase();
    const parsed = shopLookupSchema.safeParse({ email: trimmed });
    if (!parsed.success) {
      setErrors({ email: "Enter a valid email address" });
      haptic.error();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      let foundShops = await lookupShops(trimmed);
      // Sri Lanka domain fallback: if user typed .com but account is registered under .lk
      if (foundShops.length === 0 && trimmed.endsWith(".com")) {
        const lkCandidate = trimmed.replace(/\.com$/, ".lk");
        try {
          const lkShops = await lookupShops(lkCandidate);
          if (lkShops.length > 0) {
            foundShops = lkShops;
            trimmed = lkCandidate;
            setEmail(lkCandidate);
          }
        } catch {}
      }

      setShops(foundShops);
      if (foundShops.length === 1 && foundShops[0]) {
        setSlug(foundShops[0].slug);
      } else if (foundShops.length > 1) {
        // If a saved tenant slug is among the shops, keep it, else default to first
        const match = foundShops.find((s) => s.slug === savedTenantSlug);
        setSlug(match?.slug ?? foundShops[0]?.slug ?? "");
      } else {
        setSlug(savedTenantSlug ?? "");
      }
      setStep("password");
      haptic.selection();
      setTimeout(() => pwRef.current?.focus(), 150);
    } catch (err) {
      haptic.error();
      setErrors({ form: errorMessage(err, "Lookup failed") });
    } finally {
      setPending(false);
    }
  }

  async function onSignIn() {
    const trimmed = email.trim().toLowerCase();
    if (!password) {
      setErrors({ password: "Enter your password" });
      haptic.error();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      let resolvedEmail = trimmed;
      let resolvedSlug = slug;

      try {
        await signIn(resolvedEmail, password, resolvedSlug || undefined);
      } catch (err) {
        // If sign in failed with .com, automatically attempt with .lk
        if (resolvedEmail.endsWith(".com")) {
          const lkEmail = resolvedEmail.replace(/\.com$/, ".lk");
          let lkSlug = resolvedSlug;
          if (!lkSlug) {
            const lkShops = await lookupShops(lkEmail).catch(() => []);
            if (lkShops.length > 0 && lkShops[0]) {
              lkSlug = lkShops[0].slug;
            }
          }
          await signIn(lkEmail, password, lkSlug || undefined);
          resolvedEmail = lkEmail;
          setEmail(lkEmail);
          if (lkSlug) setSlug(lkSlug);
        } else {
          throw err;
        }
      }

      void SecureStore.setItemAsync(SAVED_EMAIL_KEY, resolvedEmail).catch(() => undefined);
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
        <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 20 }]}>
          <LinearGradient
            colors={["transparent", "rgba(231,198,90,0.7)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.sheetHairline}
          />
          <View style={{ gap: 6, marginBottom: 4 }}>
            <Kicker tone="gold" style={{ letterSpacing: 1.6 }}>
              {step === "email" ? "Shop sign in" : shops && shops.length > 1 ? "Pick your workspace" : "Branch sign in"}
            </Kicker>
            <Text variant="title1" display weight="700">
              Welcome back
            </Text>
            <Text variant="subhead" tone="secondary">
              {step === "email"
                ? "Enter your email to find your shop workspace."
                : "Use your branch credentials to continue."}
            </Text>
          </View>

          {step === "email" ? (
            <>
              <Field
                label="Email"
                kind="email"
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
                }}
                placeholder="you@branch.lk"
                autoComplete="username"
                returnKeyType="next"
                onSubmitEditing={onContinueEmail}
                error={errors.email}
                icon="mail"
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
                <Button
                  title={pending ? "Finding your shop…" : "Continue"}
                  iconRight={pending ? undefined : "arrowRight"}
                  size="lg"
                  onPress={onContinueEmail}
                  loading={pending}
                  block
                />
              </View>
            </>
          ) : (
            <>
              {/* Account badge */}
              <View style={[styles.accountBanner, { backgroundColor: c.card, borderColor: c.separator }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <View style={[styles.avatarMini, { backgroundColor: `${c.gold}20` }]}>
                    <Icon name="mail" size={14} color={c.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption2" tone="tertiary" upper weight="600">
                      Signing in as
                    </Text>
                    <Text variant="subhead" weight="600" numberOfLines={1}>
                      {email}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => {
                    setStep("email");
                    setErrors({});
                  }}
                  hitSlop={8}
                >
                  <Text variant="footnote" color={c.gold} weight="600">
                    Change
                  </Text>
                </Pressable>
              </View>

              {/* Multiple shops selector */}
              {shops && shops.length > 1 ? (
                <View style={{ gap: 8 }}>
                  <Text variant="footnote" tone="secondary" weight="600" upper style={{ letterSpacing: 0.8, paddingHorizontal: 4 }}>
                    Select workspace
                  </Text>
                  <View style={{ gap: 8 }}>
                    {shops.map((s) => {
                      const selected = slug === s.slug;
                      return (
                        <Pressable
                          key={s.slug}
                          onPress={() => {
                            haptic.selection();
                            setSlug(s.slug);
                          }}
                          style={[
                            styles.shopCard,
                            {
                              backgroundColor: selected ? `${c.gold}14` : c.card,
                              borderColor: selected ? c.gold : c.separator,
                            },
                          ]}
                        >
                          <View style={[styles.shopIconTile, { backgroundColor: selected ? `${c.gold}28` : `${c.label}08` }]}>
                            <Icon name="store" size={18} color={selected ? c.gold : c.label2} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text variant="body" weight={selected ? "700" : "500"}>
                              {s.name}
                            </Text>
                            <Text variant="caption1" tone="tertiary" style={{ fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" }}>
                              {s.slug}
                            </Text>
                          </View>
                          <Icon
                            name={selected ? "checkCircle" : "circle"}
                            size={18}
                            color={selected ? c.gold : c.label3}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : shops && shops.length === 1 && shops[0] ? (
                <View style={[styles.shopCardSingle, { backgroundColor: c.card, borderColor: c.separator }]}>
                  <View style={[styles.shopIconTile, { backgroundColor: `${c.gold}20` }]}>
                    <Icon name="store" size={18} color={c.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption2" tone="tertiary" upper weight="600">
                      Workspace
                    </Text>
                    <Text variant="subhead" weight="700">
                      {shops[0].name}
                    </Text>
                    <Text variant="caption2" tone="tertiary" style={{ fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" }}>
                      {shops[0].slug}
                    </Text>
                  </View>
                  <View style={[styles.verifiedPill, { backgroundColor: `${c.green}18` }]}>
                    <Icon name="shield" size={12} color={c.green} />
                    <Text variant="caption2" tone="success" weight="600">
                      Ready
                    </Text>
                  </View>
                </View>
              ) : (
                <Field
                  label="Shop workspace (optional)"
                  value={slug}
                  onChangeText={setSlug}
                  placeholder="e.g. western-jewellers"
                  autoCapitalize="none"
                  autoCorrect={false}
                  icon="store"
                  hint="Enter shop slug if your server hosts multiple accounts"
                />
              )}

              <Field
                ref={pwRef}
                label="Password"
                kind="password"
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
                }}
                placeholder="Enter your password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={onSignIn}
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
                <Button
                  title={pending ? "Signing in…" : "Sign in"}
                  iconRight={pending ? undefined : "arrowRight"}
                  size="lg"
                  onPress={onSignIn}
                  loading={pending}
                  block
                />
              </View>
            </>
          )}

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
  accountBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    ...squircle,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarMini: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  shopCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    ...squircle,
    borderWidth: 1.5,
    gap: 12,
  },
  shopCardSingle: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    ...squircle,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  shopIconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    ...squircle,
    alignItems: "center",
    justifyContent: "center",
  },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
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