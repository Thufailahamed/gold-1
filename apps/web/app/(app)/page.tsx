const CARDS = [
  { title: "Today's Sales", value: "LKR 0", hint: "Sales module not connected yet" },
  { title: "Today's Purchases", value: "LKR 0", hint: "Purchases module not connected yet" },
  { title: "Gold Purchased", value: "0 g", hint: "Old-gold module not connected yet" },
  { title: "Gold Sold", value: "0 g", hint: "Sales module not connected yet" },
  { title: "Cash", value: "LKR 0", hint: "Cash module not connected yet" },
  { title: "Inventory", value: "0 pieces", hint: "Inventory module not connected yet" },
  { title: "Pending Approvals", value: "0", hint: "Approvals module not connected yet" },
  { title: "Outstanding Receivables", value: "LKR 0", hint: "Ledger module not connected yet" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-stone-500">Branch overview</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          Figures above are placeholders. Real metrics appear as business modules connect.
        </p>
      </div>
    </div>
  );
}
