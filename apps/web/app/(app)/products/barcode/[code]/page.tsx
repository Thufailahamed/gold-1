"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { Page } from "@/components/ui";
import { ScanBarcodeIcon, SearchIcon } from "@/components/icons";

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

  const shown = decodeURIComponent(code);
  const finding = lookup.isLoading || !!lookup.data;
  return (
    <Page>
      <div className="mx-auto mt-8 max-w-md overflow-hidden rounded-[20px] bg-void text-paper shadow-5">
        <div className="relative px-6 py-8 text-center">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" />
          <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-gold/20 blur-[80px]" />
          <span className="relative mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            {finding ? <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/30" /> : null}
            <ScanBarcodeIcon size={24} />
          </span>
          <div className="g-metric relative mt-4 inline-block rounded-md bg-paper/[0.08] px-2.5 py-1 text-[13px] tracking-wider text-gold-light">{shown}</div>
          <h1 className="g-display relative mt-3 text-[22px]">{finding ? "Looking up piece…" : "No piece with this barcode"}</h1>
          <p className="relative mt-1 text-[12px] text-paper/50">
            {finding ? "Opening it as soon as it's found." : "It may be mistyped, voided, or belong to another workspace."}
          </p>
        </div>
        {finding ? (
          <div className="h-1 overflow-hidden bg-paper/10">
            <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-gold to-transparent bg-[length:200%_100%]" />
          </div>
        ) : (
          <div className="flex gap-2 border-t border-paper/10 bg-paper/[0.03] p-3">
            <Link href="/scan" className="home-btn-gold h-9 flex-1 justify-center px-3 text-[12.5px]">
              <ScanBarcodeIcon size={13} />
              Scan again
            </Link>
            <Link href="/products" className="home-btn-ghost h-9 flex-1 justify-center px-3 text-[12.5px]">
              <SearchIcon size={13} />
              Browse products
            </Link>
          </div>
        )}
      </div>
    </Page>
  );
}
