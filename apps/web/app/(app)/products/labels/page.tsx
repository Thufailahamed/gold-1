"use client";

import { use, useState } from "react";
import { Page } from "@/components/ui";
import { Card, Empty, GoldHero, HeroBadge, heroGold } from "@/components/console-kit";
import { AlertCircleIcon, PrinterIcon } from "@/components/icons";
import { assetUrl } from "@/lib/api";

/**
 * Batch label printing: /products/labels?ids=a,b,c[&back=/purchases/invoices/x]
 * Used after a purchase receive or a manufacturing finish, where a whole lot
 * of new pieces needs tagging at once.
 */
export default function BatchLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; back?: string }>;
}) {
  const sp = use(searchParams);
  const ids = Array.from(new Set((sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean))).slice(0, 200);
  // Only same-app paths; never bounce to an arbitrary URL from the query string.
  const back = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/products";
  const [copies, setCopies] = useState(1);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  return (
    <Page>
      <div className="space-y-4 print:hidden">
        <GoldHero
          icon={PrinterIcon}
          title="Print"
          accent="labels"
          badge={<HeroBadge tone={ids.length ? "gold" : "muted"}>{ids.length ? "Ready" : "Nothing selected"}</HeroBadge>}
          sub="Batch tags after a purchase receive or a manufacturing finish"
          back={{ href: back, label: "Back" }}
          actions={
            <button onClick={() => window.print()} disabled={ids.length === 0} className={heroGold}>
              <PrinterIcon size={13} />
              Print {ids.length * copies} label{ids.length * copies === 1 ? "" : "s"}
            </button>
          }
          stats={[
            { label: "Pieces", value: ids.length, accent: true },
            { label: "Copies each", value: copies },
            { label: "Labels", value: ids.length * copies },
            { label: "Failed", value: failed.size, tone: failed.size ? "bad" : "good", sub: failed.size ? "check and reload" : "all loaded" },
          ]}
        >
          {ids.length ? (
            <div className="flex items-center gap-2 text-[11px] text-paper/55">
              Copies per piece
              <span className="flex items-center rounded-lg bg-paper/[0.07] p-0.5 ring-1 ring-inset ring-paper/12">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCopies(n)}
                    className={`g-metric h-6 w-6 rounded-md text-[11px] font-semibold transition-colors ${copies === n ? "bg-gold text-void" : "text-paper/60 hover:text-paper"}`}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
          ) : null}
        </GoldHero>
        {ids.length === 0 ? (
          <Card>
            <Empty icon={PrinterIcon} title="No pieces selected" desc="Open this page from a purchase invoice or manufacturing order to print its labels." />
          </Card>
        ) : null}
        {failed.size > 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-[12px] text-rose-900 ring-1 ring-inset ring-rose-500/25">
            <AlertCircleIcon size={14} />
            {failed.size} label{failed.size === 1 ? "" : "s"} failed to load. Check that the pieces still exist and that you are signed in, then reload.
          </div>
        ) : null}
      </div>
      <div className="print-area label-sheet mt-4 flex flex-wrap gap-3 rounded-2xl bg-[repeating-linear-gradient(45deg,rgba(16,32,27,0.025)_0_8px,transparent_8px_16px)] p-4 print:mt-0 print:rounded-none print:bg-none print:p-0">
        {ids.flatMap((id) =>
          Array.from({ length: copies }).map((_, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={`${id}-${i}`}
              src={assetUrl(`/api/v1/products/${encodeURIComponent(id)}/label`)}
              alt="Barcode label"
              className="label-img max-w-sm rounded-md bg-white shadow-[0_12px_28px_-18px_rgba(16,32,27,0.5)] print:rounded-none print:shadow-none"
              onError={() => setFailed((f) => new Set(f).add(id))}
            />
          ))
        )}
      </div>
    </Page>
  );
}
