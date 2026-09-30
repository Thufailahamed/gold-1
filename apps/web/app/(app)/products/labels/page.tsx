"use client";

import { use, useState } from "react";
import { Page, PageHeader, Panel, Callout, controlClass } from "@/components/ui";
import { PrinterIcon } from "@/components/icons";
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
      <div className="print:hidden">
        <PageHeader
          back={{ href: back, label: "Back" }}
          kicker="Catalog"
          title="Print labels"
          description={`${ids.length} piece${ids.length === 1 ? "" : "s"} · ${ids.length * copies} label${ids.length * copies === 1 ? "" : "s"}`}
          actions={
            <button
              onClick={() => window.print()}
              disabled={ids.length === 0}
              className="g-btn g-btn-primary h-10 px-4 text-sm"
            >
              <PrinterIcon size={14} />
              Print
            </button>
          }
        />
        {ids.length === 0 ? (
          <Callout tone="danger" title="No pieces selected">
            Open this page from a purchase invoice or manufacturing order to print its labels.
          </Callout>
        ) : (
          <Panel title="Copies per piece" description="1–10 labels each" className="mb-6 max-w-sm">
            <input
              type="number"
              min={1}
              max={10}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className={`${controlClass} w-28`}
            />
          </Panel>
        )}
        {failed.size > 0 ? (
          <Callout tone="danger" title={`${failed.size} label${failed.size === 1 ? "" : "s"} failed to load`}>
            Check that the pieces still exist and that you are signed in, then reload.
          </Callout>
        ) : null}
      </div>
      <div className="print-area label-sheet flex flex-wrap gap-4">
        {ids.flatMap((id) =>
          Array.from({ length: copies }).map((_, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={`${id}-${i}`}
              src={assetUrl(`/api/v1/products/${encodeURIComponent(id)}/label`)}
              alt="Barcode label"
              className="label-img max-w-sm"
              onError={() => setFailed((f) => new Set(f).add(id))}
            />
          ))
        )}
      </div>
    </Page>
  );
}
