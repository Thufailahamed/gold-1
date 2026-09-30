"use client";

import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Page, Hero, Callout, Skeleton } from "@/components/ui";

type Found = { invoiceId: string; number: string; productId: string | null };

/** A scanned invoice number or sold tag, resolved to its sale. */
export default function SaleLookupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const decoded = decodeURIComponent(code);
  const router = useRouter();
  const lookup = useQuery({
    queryKey: ["sale-lookup", code],
    queryFn: () => api<Found>(`/api/v1/sales/lookup/${encodeURIComponent(decoded)}`),
    retry: false,
  });

  useEffect(() => {
    if (lookup.data) router.replace(`/sales/invoices/${lookup.data.invoiceId}`);
  }, [lookup.data, router]);

  if (lookup.isError) {
    return (
      <Page>
        <Hero kicker="Sales" title={decoded} description="No sale matches this code." />
        <Callout
          tone="danger"
          title="Sale not found"
          action={
            <button onClick={() => router.push("/sales/invoices")} className="g-btn g-btn-secondary h-8 px-3 text-xs">
              All invoices
            </button>
          }
        >
          {lookup.error instanceof Error ? lookup.error.message : "Lookup failed"}
        </Callout>
      </Page>
    );
  }
  return (
    <Page>
      <Hero kicker="Sales" title={`Looking up ${decoded}`} description="Finding the sale…" />
      <Skeleton className="h-40" />
    </Page>
  );
}
