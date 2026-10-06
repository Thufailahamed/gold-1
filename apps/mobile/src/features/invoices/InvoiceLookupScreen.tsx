import { useEffect } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { Button, Callout, Hero, Loading, Screen } from "@/ui";

type Found = { invoiceId: string; number: string; productId: string | null };

/** A scanned invoice number or sold tag, resolved to its sale. */
export default function InvoiceLookupScreen() {
  const { code = "" } = useLocalSearchParams<{ code: string }>();
  const decoded = decodeURIComponent(code);
  const lookup = useQuery({
    queryKey: ["sale-lookup", code],
    queryFn: () => api<Found>(`/api/v1/sales/lookup/${encodeURIComponent(decoded)}`),
    retry: false,
    enabled: !!code,
  });

  useEffect(() => {
    if (lookup.data) router.replace(`/sales/invoices/${lookup.data.invoiceId}`);
  }, [lookup.data]);

  return (
    <Screen>
      <Stack.Screen options={{ title: "Find sale", headerLargeTitleEnabled: false }} />
      {lookup.isError ? (
        <>
          <Hero kicker="Sales" title={decoded} subtitle="No sale matches this code." style={{ marginTop: 8 }} />
          <Callout tone="danger" title="Sale not found" style={{ marginTop: 14 }}>
            {errorMessage(lookup.error, "Lookup failed")}
          </Callout>
          <Button title="All invoices" variant="gray" onPress={() => router.replace("/sales/invoices")} style={{ alignSelf: "center", marginTop: 16 }} />
        </>
      ) : (
        <>
          <Hero kicker="Sales" title={`Looking up ${decoded}`} subtitle="Finding the sale…" style={{ marginTop: 8 }} />
          <Loading />
        </>
      )}
    </Screen>
  );
}
