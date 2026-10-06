import { useState } from "react";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Button, Callout, DateTimeField, Field, FormStack, Grid, HeaderButton, Hero, Row, Screen, Section, SelectField, Sheet, SkeletonRows, StatTile, Text, toast, useRefresh } from "@/ui";

type Rate = { id: string; purity_id: string; karat: string; rate_per_gram: number; effective_from: number; created_at: number };

export default function GoldRatesScreen() {
  const [publishing, setPublishing] = useState(false);
  const current = useQuery({ queryKey: ["gold-rates-current"], queryFn: () => api<Rate[]>("/api/v1/gold-rates/current") });
  const history = useQuery({ queryKey: ["gold-rates-history"], queryFn: () => api<{ rows: Rate[]; total: number }>("/api/v1/gold-rates?limit=50") });
  const refresh = useRefresh(current, history);
  const rates = current.data ?? [];
  const top = rates.length ? rates.reduce((a, b) => (a.rate_per_gram >= b.rate_per_gram ? a : b)) : null;

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Gold Rates", headerRight: () => <HeaderButton icon="plus" onPress={() => setPublishing(true)} accessibilityLabel="Publish rate" /> }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Masters · Live board"
        title="Gold Rates"
        subtitle="Current buying rates per gram, published by purity. Published rates apply instantly to intake and live pricing across all branches."
        stats={[
          { label: top ? `Board rate · ${top.karat}` : "Board rate", value: top ? `${top.rate_per_gram.toLocaleString()} LKR/g` : "—" },
          { label: "Purities", value: current.isLoading ? "—" : String(rates.length) },
          { label: "Revisions", value: history.data ? String(history.data.total) : "—" },
        ]}
        actions={<Button title="Publish rate" icon="coins" onPress={() => setPublishing(true)} />}
      />

      {current.isLoading ? (
        <SkeletonRows rows={2} />
      ) : current.isError ? (
        <Callout tone="danger" title="Failed to load current rates" style={{ marginTop: 14 }}>
          Check the API connection and retry.
        </Callout>
      ) : rates.length === 0 ? (
        <Callout tone="warning" title="No board rate published" style={{ marginTop: 14 }}>
          Live pricing and intake need a published rate for each purity.
        </Callout>
      ) : (
        <Grid style={{ marginTop: 14 }}>
          {rates.map((r) => (
            <StatTile key={r.purity_id} label={r.karat} value={r.rate_per_gram.toLocaleString()} unit="LKR/g" sub={`From ${dateTime(r.effective_from)}`} icon="trendUp" tone="gold" />
          ))}
        </Grid>
      )}

      <Section title="Rate history" footer="Last 50 published rates.">
        {history.isLoading ? <SkeletonRows rows={4} /> : null}
        {history.data && history.data.rows.length === 0 ? <Row title="No rates yet" subtitle="Publish the first board rate to begin." /> : null}
        {(history.data?.rows ?? []).map((r) => (
          <Row key={r.id} title={r.karat} subtitle={dateTime(r.effective_from)} value={<Text variant="body" num weight="600">{`${r.rate_per_gram.toLocaleString()} LKR`}</Text>} />
        ))}
      </Section>
      {publishing ? <PublishSheet onClose={() => setPublishing(false)} /> : null}
    </Screen>
  );
}

function PublishSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const purities = useQuery({ queryKey: ["master-all", "purities"], queryFn: () => api<{ rows: { id: string; karat: string }[] }>("/api/v1/masters/purities?limit=100") });
  const [purityId, setPurityId] = useState("");
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => Date.now());
  const n = Number(rate.replace(/,/g, ""));
  const valid = !!purityId && Number.isFinite(n) && n > 0;
  const create = useMutation({
    mutationFn: () => api("/api/v1/gold-rates", { method: "POST", body: JSON.stringify({ purityId, ratePerGram: n, effectiveFrom }) }),
    onSuccess: () => {
      toast.success("Rate published");
      void qc.invalidateQueries({ queryKey: ["gold-rates-current"] });
      void qc.invalidateQueries({ queryKey: ["gold-rates-history"] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => toast.error(e, "Publish failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Publish rate" submitLabel="Publish" onSubmit={() => create.mutate()} submitting={create.isPending} canSubmit={valid}>
      <FormStack>
        <SelectField label="Purity" value={purityId} options={(purities.data?.rows ?? []).map((p) => ({ value: p.id, label: p.karat }))} onChange={setPurityId} />
        <Field label="Rate per gram (LKR)" kind="money" value={rate} onChangeText={setRate} placeholder="0.00" error={rate && !(n > 0) ? "Must be above 0" : null} />
        <DateTimeField label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} />
      </FormStack>
    </Sheet>
  );
}
