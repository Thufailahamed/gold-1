"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { Page, Callout, Skeleton } from "@/components/ui";

type Lookup = { product: { id: string } };

export default function BarcodeLookupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const lookup = useQuery({
    queryKey: ["barcode", code],
    queryFn: () => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code)}`),
    retry: false,
  });

  useEffect(() => {
    if (lookup.data) router.replace(`/products/${lookup.data.product.id}`);
  }, [lookup.data, router]);

  if (lookup.isLoading)
    return (
      <Page>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-32 rounded-xl" />
      </Page>
    );
  return (
    <Page>
      <Callout
        tone="danger"
        title="Product not found"
        action={
          <button
            onClick={() => router.push("/products")}
            className="g-btn g-btn-secondary h-8 px-3 text-xs"
          >
            Back to list
          </button>
        }
      >
        No product found for barcode{" "}
        <span className="font-mono">{decodeURIComponent(code)}</span>.
      </Callout>
    </Page>
  );
}
