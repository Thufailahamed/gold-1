const CARDS = [
  { title: "Cash today", value: "—", hint: "Connect cash module (Phase 2)" },
  { title: "Gold on hand", value: "—", hint: "Connect gold ledger (Phase 2)" },
  { title: "Low stock", value: "—", hint: "Connect inventory (Phase 2)" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-stone-500">Branch overview</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <div key={c.title} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-stone-500">{c.title}</p>
            <p className="mt-2 text-3xl font-semibold">{c.value}</p>
            <p className="mt-1 text-xs text-stone-400">{c.hint}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
        <p className="text-sm font-medium">No activity yet</p>
        <p className="mt-1 text-sm text-stone-500">
          Sales, purchases and gold movements will appear here once Phase-2 modules are connected.
        </p>
      </div>
    </div>
  );
}
