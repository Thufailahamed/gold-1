import { useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import Constants from "expo-constants";
import { changePasswordSchema } from "@goldos/shared";
import { api, API_BASE } from "@/lib/api";
import { useBranch, useSession } from "@/lib/session";
import { GUTTER, useTheme } from "@/theme";
import { NAV, visibleItems } from "@/features/nav/modules";
import { Avatar, Card, confirm, Field, FormStack, OptionSheet, Pill, Row, Screen, Section, Sheet, Text, toast } from "@/ui";

export default function MoreScreen() {
  const { c } = useTheme();
  const { me, can, signOut, forgetSession, perms } = useSession();
  const b = useBranch();
  const [branchOpen, setBranchOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <Screen>
      <Stack.Screen options={{ title: "More" }} />

      <Card style={{ marginTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Avatar name={me?.user.name || me?.user.email} size={58} gold />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title3" numberOfLines={1}>
              {me?.user.name || "Account"}
            </Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {me?.user.email}
            </Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
              <Pill tone="success" dot size="sm">
                Session active
              </Pill>
              <Pill size="sm">{`${perms.length} permissions`}</Pill>
            </View>
          </View>
        </View>
      </Card>

      <Section title="Workspace">
        <Row
          icon="building"
          iconColor={c.vault2}
          title="Working branch"
          value={b.branch?.name ?? (b.isLoading ? "…" : "None")}
          onPress={() => setBranchOpen(true)}
        />
      </Section>

      {NAV.map((section) => {
        const items = visibleItems(section.items, can);
        if (items.length === 0) return null;
        return (
          <Section key={section.title} title={section.title}>
            {items.map((i) => (
              <Row key={i.href} title={i.label} subtitle={i.subtitle} icon={i.icon} iconColor={i.color} href={i.href as Href} />
            ))}
          </Section>
        );
      })}

      <Section title="Account">
        <Row icon="key" iconColor="#8E8E93" title="Change password" onPress={() => setPwOpen(true)} />
        <Row
          icon="signOut"
          iconColor="#FF3B30"
          title="Sign out"
          destructive
          chevron={false}
          onPress={async () => {
            if (await confirm({ title: "Sign out of GoldOS?", confirmText: "Sign out", destructive: true })) {
              await signOut();
              router.replace("/login");
            }
          }}
        />
      </Section>

      <View style={{ alignItems: "center", marginTop: 24, gap: 4, paddingHorizontal: GUTTER }}>
        <Text variant="caption1" tone="tertiary">
          GoldOS {Constants.expoConfig?.version ?? "1.0.0"} · LK · Live
        </Text>
        <Text variant="caption2" tone="tertiary" numberOfLines={1}>
          {API_BASE.replace(/^https?:\/\//, "")}
        </Text>
      </View>

      <OptionSheet
        visible={branchOpen}
        onClose={() => setBranchOpen(false)}
        title="Working branch"
        value={b.branchId}
        options={b.branches.map((br) => ({ value: br.id, label: br.name, subtitle: br.code }))}
        onPick={(id) => {
          if (id) {
            b.setBranchId(id);
            toast.success("Branch switched", b.branches.find((x) => x.id === id)?.name);
          }
          setBranchOpen(false);
        }}
      />

      <ChangePasswordSheet
        visible={pwOpen}
        onClose={() => setPwOpen(false)}
        onDone={async () => {
          setPwOpen(false);
          toast.success("Password changed", "Please sign in again");
          await forgetSession();
          router.replace("/login");
        }}
      />
    </Screen>
  );
}

function ChangePasswordSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = confirmPw.length > 0 && confirmPw !== next;
  const valid = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next }).success && next === confirmPw;

  async function submit() {
    setBusy(true);
    try {
      await api("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setCurrent("");
      setNext("");
      setConfirmPw("");
      onDone();
    } catch (e) {
      toast.error(e, "Change failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Change password" submitLabel="Save" onSubmit={submit} canSubmit={valid} submitting={busy}>
      <FormStack>
        <Field label="Current password" kind="password" value={current} onChangeText={setCurrent} autoComplete="current-password" />
        <Field label="New password" kind="password" value={next} onChangeText={setNext} autoComplete="new-password" hint="At least 8 characters" />
        <Field label="Confirm new password" kind="password" value={confirmPw} onChangeText={setConfirmPw} error={mismatch ? "Passwords don't match" : null} />
        <Text variant="footnote" tone="secondary">
          You'll be signed out on every device and asked to sign in again.
        </Text>
      </FormStack>
    </Sheet>
  );
}
