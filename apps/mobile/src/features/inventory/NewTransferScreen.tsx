import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { extractScanCode, normalizeCode } from "@/lib/barcode";
import { g } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useBranch, useSession } from "@/lib/session";
import { GUTTER, radius, useTheme } from "@/theme";
import {
  BottomBar,
  Button,
  Callout,
  ContinuousScanner,
  Field,
  FormStack,
  Hero,
  Icon,
  IconButton,
  Loading,
  Row,
  Screen,
  Section,
  SelectField,
  Text,
  toast,
} from "@/ui";

type Branch = { id: string; name: string; code: string; member: boolean };
type Lookup = { product: { id: string; barcode: string; sku: string | null; name: string; karat: string; net_mg: number; status: string; branch_id: string } };
type Line = { productId: string; barcode: string; name: string; karat: string; netMg: number };
const MAX_LINES = 100;

export default function NewTransferScreen() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const { can } = useSession();
  const canCreate = can("products:edit");
  const { branchId: activeBranch } = useBranch();
  const [scan, setScan] = useState("");
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  // Camera callbacks fire faster than renders; validate against the latest list.
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const inFlight = useRef(new Set<string>());

  const branches = useQuery({ queryKey: ["transfer-branches"], queryFn: () => api<Branch[]>("/api/v1/transfers/branches") });
  const memberBranches = (branches.data ?? []).filter((b) => b.member);
  const toChoices = (branches.data ?? []).filter((b) => b.id !== fromBranchId);

  useEffect(() => {
    if (fromBranchId || memberBranches.length === 0) return;
    const pick = memberBranches.find((b) => b.id === activeBranch) ?? memberBranches[0];
    if (pick) setFromBranchId(pick.id);
  }, [fromBranchId, memberBranches, activeBranch]);

  function changeFrom(id: string) {
    if (id === fromBranchId) return;
    if (lines.length > 0) toast.info("Scanned list cleared — pieces must belong to the sending branch");
    setLines([]);
    setFromBranchId(id);
    if (toBranchId === id) setToBranchId("");
  }

  const report = (ok: boolean, text: string) => {
    setLast({ ok, text });
    if (ok) haptic.success();
    else haptic.error();
    if (!scanning) (ok ? toast.success : toast.warning)(text);
  };

  async function addCode(raw: string) {
    const code = normalizeCode(extractScanCode(raw) || raw);
    if (!code) return;
    if (!fromBranchId) return report(false, "Choose the sending branch first");
    if (linesRef.current.some((l) => l.barcode === code) || inFlight.current.has(code)) return report(false, `${code} is already on the list`);
    inFlight.current.add(code);
    try {
      const { product: p } = await api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code)}`);
      if (linesRef.current.some((l) => l.productId === p.id)) return report(false, `${p.barcode} is already on the list`);
      if (p.status !== "IN_STOCK") return report(false, `${p.barcode} is ${p.status.replace(/_/g, " ").toLowerCase()}, not in stock`);
      if (p.branch_id !== fromBranchId) return report(false, `${p.barcode} is not at the sending branch`);
      if (linesRef.current.length >= MAX_LINES) return report(false, `A transfer holds at most ${MAX_LINES} pieces`);
      const line = { productId: p.id, barcode: p.barcode, name: p.name, karat: p.karat, netMg: p.net_mg };
      linesRef.current = [...linesRef.current, line];
      setLines((ls) => [...ls, line]);
      report(true, `Added ${p.barcode}`);
    } catch (e) {
      report(false, errorMessage(e, "Lookup failed"));
    } finally {
      inFlight.current.delete(code);
    }
  }

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/transfers", {
        method: "POST",
        body: JSON.stringify({ fromBranchId, toBranchId, productIds: lines.map((l) => l.productId), reason: reason.trim() || undefined }),
      }),
    onSuccess: (d) => {
      toast.success(`Transfer ${d.number} requested`);
      void qc.invalidateQueries({ queryKey: ["transfers"] });
      router.replace(`/inventory/transfers/${d.id}` as Href);
    },
    onError: (e) => toast.error(e, "Request failed"),
  });

  const totalMg = lines.reduce((n, l) => n + l.netMg, 0);
  const fromName = memberBranches.find((b) => b.id === fromBranchId)?.name;
  const toName = toChoices.find((b) => b.id === toBranchId)?.name;
  const canSubmit = canCreate && !!fromBranchId && !!toBranchId && fromBranchId !== toBranchId && lines.length > 0 && !create.isPending;

  return (
    <>
      <Stack.Screen options={{ title: "New transfer", headerLargeTitleEnabled: false }} />
      <Screen
        footer={
          <BottomBar>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text variant="footnote" tone="secondary" num style={{ flex: 1 }}>
                {`${lines.length} piece${lines.length === 1 ? "" : "s"} · ${g(totalMg)} net`}
              </Text>
              <Button title="Request transfer" icon="truck" disabled={!canSubmit} loading={create.isPending} onPress={() => create.mutate()} />
            </View>
          </BottomBar>
        }
      >
        <Hero
          style={{ marginTop: 8 }}
          kicker="Inventory"
          title={`${fromName ?? "Sending branch"} → ${toName ?? "Receiving branch"}`}
          subtitle="Choose the route, then scan each piece to send."
          stats={[
            { label: "Pieces", value: String(lines.length) },
            { label: "Net weight", value: g(totalMg) },
          ]}
        >
          {canCreate ? (
            <View style={{ marginTop: 12, gap: 10 }}>
              <Button title="Scan pieces" icon="scan" size="lg" block disabled={!fromBranchId} onPress={() => setScanning(true)} />
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Field
                    kind="code"
                    value={scan}
                    onChangeText={setScan}
                    placeholder={fromBranchId ? "Or type a barcode…" : "Choose the sending branch first"}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    onSubmitEditing={() => {
                      void addCode(scan);
                      setScan("");
                    }}
                  />
                </View>
                <IconButton
                  name="plus"
                  variant="filled"
                  size={44}
                  disabled={!scan.trim()}
                  onPress={() => {
                    void addCode(scan);
                    setScan("");
                  }}
                  accessibilityLabel="Add barcode"
                />
              </View>
            </View>
          ) : null}
        </Hero>

        {!canCreate ? (
          <Callout tone="warning" title="You cannot request transfers" style={{ marginTop: 14 }}>
            Requesting a transfer needs the products:edit permission.
          </Callout>
        ) : null}

        <Section title="Route">
          <View style={{ padding: 14 }}>
            {branches.isLoading ? (
              <Loading />
            ) : branches.isError ? (
              <Callout tone="danger" title="Could not load branches" style={{ marginHorizontal: 0 }}>
                {errorMessage(branches.error, "Retry in a moment.")}
              </Callout>
            ) : (
              <FormStack>
                <SelectField
                  label="From (sending branch)"
                  value={fromBranchId}
                  options={memberBranches.map((b) => ({ value: b.id, label: b.name, subtitle: b.code }))}
                  onChange={(v) => changeFrom(v)}
                  hint={memberBranches.length === 0 ? "You are not a member of any branch." : "Changing this clears the scanned list."}
                />
                <SelectField
                  label="To (receiving branch)"
                  value={toBranchId}
                  options={toChoices.map((b) => ({ value: b.id, label: b.name, subtitle: b.code }))}
                  onChange={setToBranchId}
                  error={toBranchId && toBranchId === fromBranchId ? "Choose a different branch" : null}
                />
                <Field label="Reason (optional)" multiline value={reason} onChangeText={setReason} maxLength={500} placeholder="e.g. Restock for weekend exhibition" />
              </FormStack>
            )}
          </View>
        </Section>

        <Section title={`Pieces to send · ${lines.length}`} action={lines.length > 0 ? { label: "Clear", onPress: () => setLines([]) } : undefined}>
          {lines.length === 0 ? <Row icon="scan" title="No pieces yet" subtitle="Scan pieces that are in stock at the sending branch." numberOfLines={2} /> : null}
          {lines.map((l) => (
            <Row
              key={l.productId}
              title={l.name}
              subtitle={`${l.barcode} · ${l.karat} · ${g(l.netMg)}`}
              right={<IconButton name="trash" variant="plain" color={c.red} size={32} onPress={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))} accessibilityLabel={`Remove ${l.barcode}`} />}
            />
          ))}
        </Section>
      </Screen>

      <ContinuousScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(code) => void addCode(code)}
        title="Scan pieces to send"
        hint={`From ${fromName ?? "sending branch"}`}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(28,28,30,0.92)", borderRadius: radius.lg, borderCurve: "continuous", padding: 14 }}>
            {last ? <Icon name={last.ok ? "checkCircle" : "alert"} size={18} color={last.ok ? c.green : c.red} /> : null}
            <Text variant="subhead" tone="onVault" numberOfLines={2} style={{ flex: 1 }}>
              {last?.text ?? "Point at each tag"}
            </Text>
            <Text variant="headline" num tone="onVault">
              {lines.length}
            </Text>
          </View>
        }
      />
    </>
  );
}
