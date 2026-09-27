"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ItemDraft = {
  key: number;
  categoryId: string;
  metalTypeId: string;
  purityId: string;
  name: string;
  grossG: string;
  costLkr: string;
};

type Option = { id: string; name?: string; karat?: string };

const inputCls =
  "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

export function usePurchaseOptions() {
  const cats = useQuery({
    queryKey: ["categories-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/categories?limit=100"),
  });
  const purs = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/purities?limit=100"),
  });
  const metals = useQuery({
    queryKey: ["metals-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/metal-types?limit=100"),
  });
  return { cats: cats.data?.rows ?? [], purs: purs.data?.rows ?? [], metals: metals.data?.rows ?? [] };
}

export function ItemEditor({
  items,
  onChange,
}: {
  items: ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
}) {
  const { cats, purs, metals } = usePurchaseOptions();

  function set(key: number, patch: Partial<ItemDraft>) {
    onChange(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.key} className="grid grid-cols-2 gap-2 rounded-lg border border-stone-200 p-3 md:grid-cols-6">
          <input
            placeholder={`Item ${i + 1} name`}
            value={it.name}
            onChange={(e) => set(it.key, { name: e.target.value })}
            className={`${inputCls} col-span-2`}
          />
          <select value={it.categoryId} onChange={(e) => set(it.key, { categoryId: e.target.value })} className={inputCls}>
            <option value="">Category…</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={it.metalTypeId} onChange={(e) => set(it.key, { metalTypeId: e.target.value })} className={inputCls}>
            <option value="">Metal…</option>
            {metals.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={it.purityId} onChange={(e) => set(it.key, { purityId: e.target.value })} className={inputCls}>
            <option value="">Purity…</option>
            {purs.map((p) => (
              <option key={p.id} value={p.id}>{p.karat}</option>
            ))}
          </select>
          <input
            placeholder="Gross g"
            type="number"
            step="any"
            value={it.grossG}
            onChange={(e) => set(it.key, { grossG: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="Est/actual cost LKR"
            type="number"
            step="any"
            value={it.costLkr}
            onChange={(e) => set(it.key, { costLkr: e.target.value })}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((x) => x.key !== it.key))}
            className="text-xs text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...items,
            { key: Date.now(), categoryId: "", metalTypeId: "", purityId: "", name: "", grossG: "", costLkr: "" },
          ])
        }
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-stone-100"
      >
        + Add item
      </button>
    </div>
  );
}
