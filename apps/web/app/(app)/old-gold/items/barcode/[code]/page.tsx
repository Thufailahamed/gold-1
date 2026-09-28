"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function OldGoldBarcodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const lookup = useQuery({
    queryKey: ["og-barcode", code],
    queryFn: () => api<{ item: { id: string } }>(`/api/v1/oldgold/items/barcode/${encodeURIComponent(code)}`),
    retry: false,
  });

  if (lookup.isLoading) return <div className="h-32 animate-pulse rounded-xl bg-stone-200" />;
  if (lookup.isError) return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">No old-gold item for {decodeURIComponent(code)}.</div>;
  if (lookup.data) {
    const id = lookup.data.item.id;
    if (typeof window !== "undefined") window.location.replace(`/old-gold/items/${id}`);
  }
  return null;
}
