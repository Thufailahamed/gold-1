"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [copies, setCopies] = useState(1);
  const url = `${API}/api/v1/products/${id}/label`;

  return (
    <div className="space-y-4">
      <button onClick={() => router.push(`/products/${id}`)} className="text-sm text-stone-500 hover:underline print:hidden">
        ← Back
      </button>
      <div className="flex items-center gap-3 print:hidden">
        <label className="text-sm font-medium">Copies</label>
        <input
          type="number"
          min={1}
          max={50}
          value={copies}
          onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          className="w-20 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
        />
        <button onClick={() => window.print()} className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white">
          Print
        </button>
      </div>
      <div className="print-area flex flex-wrap gap-4">
        {Array.from({ length: copies }).map((_, i) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={i} src={url} alt="Barcode label" className="max-w-sm border" />
        ))}
      </div>
    </div>
  );
}
