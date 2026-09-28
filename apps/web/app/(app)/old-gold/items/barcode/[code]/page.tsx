"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Page, Hero, Skeleton, Callout } from "@/components/ui";

export default function OldGoldBarcodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const decoded = decodeURIComponent(code);
  const lookup = useQuery({
    queryKey: ["og-barcode", code],
    queryFn: () => api<{ item: { id: string } }>(`/api/v1/oldgold/items/barcode/${encodeURIComponent(code)}`),
    retry: false,
  });

  if (lookup.isLoading) {
    return (
      <Page>
        <Hero kicker="Old gold" title={`Looking up ${decoded}`} description="Checking the vault…" />
        <Skeleton className="h-40" />
      </Page>
    );
  }
  if (lookup.isError) {
    return (
      <Page>
        <Hero kicker="Old gold" title={decoded} description="No match for this OG- number." />
        <Callout tone="danger" title="No old-gold item found">
          Nothing in the vault matches <span className="g-metric">{decoded}</span>.{" "}
          <Link href="/old-gold/items" className="font-medium underline">Back to items</Link>
        </Callout>
      </Page>
    );
  }
  if (lookup.data) {
    const id = lookup.data.item.id;
    if (typeof window !== "undefined") window.location.replace(`/old-gold/items/${id}`);
  }
  return null;
}
