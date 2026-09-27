"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";

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

  if (lookup.isLoading) return <div className="h-32 animate-pulse rounded-xl bg-stone-200" />;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      No product found for barcode {decodeURIComponent(code)}.{" "}
      <button onClick={() => router.push("/products")} className="underline">
        Back to list
      </button>
    </div>
  );
}
