import { useEffect } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Callout, Loading, Screen } from "@/ui";

/** /products/barcode/:code resolves a printed barcode to its product page. */
export default function BarcodeLookupScreen() {
  const { code = "" } = useLocalSearchParams<{ code: string }>();
  const lookup = useQuery({
    queryKey: ["barcode", code],
    queryFn: () => api<{ product: { id: string } }>(`/api/v1/products/barcode/${encodeURIComponent(code)}`),
    retry: false,
    enabled: !!code,
  });

  useEffect(() => {
    if (lookup.data) router.replace(`/products/${lookup.data.product.id}`);
  }, [lookup.data]);

  return (
    <Screen>
      <Stack.Screen options={{ title: "Barcode", headerLargeTitleEnabled: false }} />
      {lookup.isLoading || lookup.data ? (
        <Loading />
      ) : (
        <>
          <Callout tone="danger" title="Product not found" style={{ marginTop: 16 }}>
            {`No product found for barcode ${decodeURIComponent(code)}.`}
          </Callout>
          <Button title="Back to products" variant="plain" onPress={() => router.replace("/products")} style={{ alignSelf: "center", marginTop: 12 }} />
        </>
      )}
    </Screen>
  );
}
