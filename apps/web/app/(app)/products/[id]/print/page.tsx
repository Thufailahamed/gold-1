"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Page, PageHeader, Panel, controlClass } from "@/components/ui";
import { PrinterIcon } from "@/components/icons";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [copies, setCopies] = useState(1);
  const url = `${API}/api/v1/products/${id}/label`;

  return (
    <Page>
      <div className="print:hidden">
        <PageHeader
          back={{ href: `/products/${id}`, label: "Product" }}
          kicker="Catalog"
          title="Print labels"
          description="Choose how many label copies to print."
          actions={
            <button onClick={() => window.print()} className="g-btn g-btn-primary h-10 px-4 text-sm">
              <PrinterIcon size={14} />
              Print
            </button>
          }
        />
        <Panel title="Copies" description="1–50 labels per run" className="mb-6 max-w-sm">
          <input
            type="number"
            min={1}
            max={50}
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className={`${controlClass} w-28`}
          />
        </Panel>
      </div>
      <div className="print-area flex flex-wrap gap-4">
        {Array.from({ length: copies }).map((_, i) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={i} src={url} alt="Barcode label" className="label-img max-w-sm" />
        ))}
      </div>
    </Page>
  );
}
