import { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { appendFile, formApi, post } from "@/lib/api";
import { pickFile } from "@/lib/pick";
import { useTheme } from "@/theme";
import { Button, Callout, confirm, EmptyState, Field, FormStack, KeyValue, OptionSheet, Pill, Row, Section, Sheet, Text, toast } from "@/ui";
import { fmt, lookupCode, METHODS, saleable, type CartLine, type Customer, type PayRow } from "./pos-parts";

/* ------------------------------------------------------------------ what /sales/scan-bill returns */

type BillProduct = { id: string; barcode: string; name: string; karat: string; netMg: number; grossMg: number; status: string; branchId: string; categoryName: string };
type BillOldGold = { id: string; number: string; description: string; itemType: string; netMg: number; karat: string | null };
type BillLine = {
  line: number;
  ref: string | null;
  fromOldGold: boolean;
  description: string | null;
  weightText: string | null;
  weightMg: number | null;
  amountCents: number | null;
  match: "barcode" | "weight" | "none";
  product: BillProduct | null;
  candidates: BillProduct[];
  oldGold: BillOldGold[];
  categoryId: string | null;
  warnings: string[];
};
type BillScan = {
  date: string | null;
  billNo: string | null;
  customer: { name: string | null; place: string | null; phone: string | null };
  lines: BillLine[];
  totalCents: number | null;
  payments: { method: string; amountCents: number; label: string | null }[];
  warnings: string[];
  customerMatch: Customer | null;
  categories: { id: string; name: string }[];
  metalTypeId: string | null;
};

/** What a bill line will become on the cart: a piece in stock, an old gold piece to convert, or nothing. */
type Pick = { kind: "product"; product: BillProduct } | { kind: "oldgold"; item: BillOldGold } | null;

export type LoadedBill = { cart: CartLine[]; customer: Customer; pays: PayRow[]; notes: string };

const grams = (mg: number) => `${(mg / 1000).toFixed(3)} g`;

/** The pick the server's match suggests: its product, or old gold of the same weight. */
function defaultPick(l: BillLine): Pick {
  if (l.product) return { kind: "product", product: l.product };
  const og = l.oldGold[0];
  if (l.fromOldGold && og && l.weightMg !== null && Math.abs(og.netMg - l.weightMg) <= 10) return { kind: "oldgold", item: og };
  return null;
}

/**
 * Photo of a handwritten bill → the API reads it and matches the lines to
 * stock → the cashier checks every line here → the pieces, the customer and
 * the payments are put on the POS cart. The sale itself is charged through
 * the normal checkout, so prices, credit and approvals are checked as usual.
 */
export function BillScanSheet({ visible, onClose, branchId, onLoad }: { visible: boolean; onClose: () => void; branchId: string; onLoad: (bill: LoadedBill) => void }) {
  const { c } = useTheme();
  const [scan, setScan] = useState<BillScan | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [cats, setCats] = useState<(string | null)[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [picking, setPicking] = useState<number | null>(null);
  const [catFor, setCatFor] = useState<number | null>(null);

  function reset() {
    setScan(null);
    setPicks([]);
    setCats([]);
    setName("");
    setPhone("");
  }
  function close() {
    reset();
    onClose();
  }

  const read = useMutation({
    mutationFn: async () => {
      const file = await pickFile({ title: "Photo of the bill" });
      if (!file) return null;
      const form = new FormData();
      form.append("branchId", branchId);
      appendFile(form, "file", file);
      return formApi<BillScan>("/api/v1/sales/scan-bill", form);
    },
    onSuccess: (d) => {
      if (!d) return;
      setScan(d);
      setPicks(d.lines.map(defaultPick));
      setCats(d.lines.map((l) => l.categoryId));
      setName(d.customer.name ?? "");
      setPhone(d.customer.phone ?? "");
    },
    onError: (e) => toast.error(e, "Could not read the bill"),
  });

  const load = useMutation({
    mutationFn: async () => {
      const s = scan!;
      let customer = s.customerMatch;
      if (!customer) {
        const made = await post<Customer>("/api/v1/customers", {
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: s.customer.place ?? undefined,
          branchId,
        });
        customer = { id: made.id, name: made.name, code: made.code, phone: made.phone };
      }
      const cart: CartLine[] = [];
      const failed: string[] = [];
      for (let i = 0; i < s.lines.length; i++) {
        const l = s.lines[i]!;
        const p = picks[i];
        if (!p) continue;
        try {
          let barcode = p.kind === "product" ? p.product.barcode : "";
          if (p.kind === "oldgold") {
            const made = await post<{ productId: string; barcode: string }>(`/api/v1/oldgold/items/${encodeURIComponent(p.item.id)}/convert`, {
              categoryId: cats[i],
              metalTypeId: s.metalTypeId,
              name: (l.description ?? p.item.description).slice(0, 100),
            });
            barcode = made.barcode;
          }
          const d = await lookupCode(barcode);
          const ok = saleable(d, branchId, customer);
          if ("error" in ok) throw new Error(ok.error);
          // The bill's price is what was agreed; the shelf price goes with it so the till records the override.
          const price = l.amountCents ?? ok.price;
          cart.push({
            productId: d.product.id,
            barcode: d.product.barcode,
            name: d.product.name,
            karat: d.product.karat,
            netMg: d.product.net_mg,
            priceCents: price,
            listPriceCents: price !== ok.price ? ok.price : undefined,
            discountCents: 0,
            reservedFor:
              d.product.status === "RESERVED" && d.product.reserved_customer_id
                ? { id: d.product.reserved_customer_id, name: d.product.reserved_customer_name ?? "Customer" }
                : undefined,
          });
        } catch (e) {
          failed.push(`Line ${l.line}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
      const methods = new Set(METHODS);
      const pays: PayRow[] = s.payments.map((p) => ({ method: methods.has(p.method) ? p.method : "other", amountLkr: String(p.amountCents / 100) }));
      const notes = ["Paper bill", s.billNo ? `#${s.billNo}` : null, s.date].filter(Boolean).join(" ");
      return { bill: { cart, customer, pays: pays.length ? pays : [{ method: "cash", amountLkr: "" }], notes }, failed };
    },
    onSuccess: ({ bill, failed }) => {
      const missing = scan!.lines.length - bill.cart.length;
      onLoad(bill);
      close();
      if (failed.length) toast.error(failed.join("\n"));
      if (missing > 0) toast.info(`${missing} line${missing === 1 ? "" : "s"} not on the cart — scan ${missing === 1 ? "that piece" : "those pieces"} to finish the bill`);
      else toast.success("Bill loaded — check the cart, then charge");
    },
    onError: (e) => toast.error(e, "Could not load the bill"),
  });

  async function submit() {
    const converting = picks.filter((p) => p?.kind === "oldgold").length;
    if (converting > 0) {
      const ok = await confirm({
        title: `Convert ${converting} old gold piece${converting === 1 ? "" : "s"}?`,
        message: "Each becomes a product on the shelf and goes on this sale. If the sale is not completed, the products stay in stock.",
        confirmText: "Convert and load",
      });
      if (!ok) return;
    }
    load.mutate();
  }

  const s = scan;
  const needsName = !!s && !s.customerMatch && !name.trim();
  const needsCategory = picks.some((p, i) => p?.kind === "oldgold" && !cats[i]);
  const chosen = picks.filter(Boolean).length;
  const line = picking !== null && s ? s.lines[picking]! : null;
  // Pieces already chosen on other lines are not offered again.
  const taken = new Set(picks.map((p, i) => (p && i !== picking ? (p.kind === "product" ? p.product.id : p.item.id) : "")));

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Scan a paper bill"
      submitLabel={s ? "Load into cart" : undefined}
      onSubmit={s ? submit : undefined}
      submitting={load.isPending}
      canSubmit={!!s && chosen > 0 && !needsName && !needsCategory && !!(s.metalTypeId || !picks.some((p) => p?.kind === "oldgold"))}
    >
      {!s ? (
        <View style={{ paddingTop: 12 }}>
          <EmptyState
            icon="receipt"
            title="Read a handwritten bill"
            message="Take a straight, well-lit photo of the whole bill. The pieces, customer and payments are read and matched to stock for you to check."
          />
          <View style={{ marginHorizontal: 16 }}>
            <Button title={read.isPending ? "Reading the bill…" : "Take or choose a photo"} icon="camera" size="lg" block loading={read.isPending} disabled={!branchId} onPress={() => read.mutate()} />
          </View>
        </View>
      ) : (
        <>
          {s.warnings.length ? (
            <Callout tone="warning" title="Check these" style={{ marginTop: 12 }}>
              {s.warnings.join("\n")}
            </Callout>
          ) : null}

          <Section title="Bill">
            {s.billNo ? <KeyValue label="Bill no." value={s.billNo} /> : null}
            {s.date ? <KeyValue label="Date" value={s.date} /> : null}
            <KeyValue label="Total on the bill" value={s.totalCents !== null ? `${fmt(s.totalCents)} LKR` : "Not read"} />
          </Section>

          <Section title="Customer" footer={s.customerMatch ? "Found by phone number." : "No customer has this phone number. They are added when you load the bill."}>
            {s.customerMatch ? (
              <Row icon="personCheck" iconColor={c.green} title={s.customerMatch.name} subtitle={[s.customerMatch.code, s.customerMatch.phone].filter(Boolean).join(" · ")} />
            ) : (
              <FormStack>
                <Field label="Name" value={name} onChangeText={setName} placeholder="Customer name" error={needsName ? "A bill needs a customer" : null} />
                <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="07XXXXXXXX" keyboardType="phone-pad" />
              </FormStack>
            )}
          </Section>

          <Section title={`Pieces · ${chosen} of ${s.lines.length} matched`} footer="Tap a line to choose its piece.">
            {s.lines.map((l, i) => {
              const p = picks[i];
              const ref = l.fromOldGold ? "New · old gold" : (l.ref ?? "No ref");
              return (
                <View key={i} style={{ paddingVertical: 4 }}>
                  <Row
                    icon={l.fromOldGold ? "coins" : "gem"}
                    iconColor={p ? c.green : c.orange}
                    title={l.description ?? `Line ${l.line}`}
                    subtitle={`${ref} · ${l.weightMg !== null ? grams(l.weightMg) : (l.weightText ?? "no weight")}`}
                    value={l.amountCents !== null ? fmt(l.amountCents) : "—"}
                    onPress={() => setPicking(i)}
                  />
                  <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 4 }}>
                    {p ? (
                      <Pill tone={p.kind === "product" && l.match === "barcode" ? "success" : "warning"} size="sm" icon={p.kind === "product" ? "tag" : "coins"}>
                        {p.kind === "product" ? `${p.product.barcode} · ${p.product.name} · ${grams(p.product.netMg)}` : `${p.item.number} → new product · ${grams(p.item.netMg)}`}
                      </Pill>
                    ) : (
                      <Pill tone="danger" size="sm">
                        No piece chosen — not loaded
                      </Pill>
                    )}
                    {p?.kind === "oldgold" ? (
                      <Text variant="caption1" tone="secondary" onPress={() => setCatFor(i)}>
                        {`Category: ${s.categories.find((x) => x.id === cats[i])?.name ?? "choose…"}`}
                      </Text>
                    ) : null}
                    {l.warnings.map((w, j) => (
                      <Text key={j} variant="caption1" color={c.orangeText}>
                        {w}
                      </Text>
                    ))}
                  </View>
                </View>
              );
            })}
          </Section>

          {s.payments.length ? (
            <Section title="Payments" footer="Put on the payment sheet; change them there before charging.">
              {s.payments.map((p, i) => (
                <KeyValue key={i} label={`${p.method.charAt(0).toUpperCase()}${p.method.slice(1)}${p.label ? ` (${p.label})` : ""}`} value={`${fmt(p.amountCents)} LKR`} />
              ))}
            </Section>
          ) : null}

          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Button title="Scan another photo" icon="camera" variant="gray" block loading={read.isPending} onPress={() => read.mutate()} />
          </View>
        </>
      )}

      <OptionSheet
        visible={line !== null}
        onClose={() => setPicking(null)}
        title={line ? `Line ${line.line} · ${line.description ?? ""}` : ""}
        value={(() => {
          const p = picking !== null ? picks[picking] : null;
          return p ? (p.kind === "product" ? `p:${p.product.id}` : `o:${p.item.id}`) : "";
        })()}
        allowClear
        clearLabel="No piece (scan it later)"
        options={
          line
            ? [
                ...(line.product && !line.candidates.some((x) => x.id === line.product!.id) ? [line.product] : []),
                ...line.candidates,
              ]
                .filter((x) => !taken.has(x.id))
                .map((x) => ({ value: `p:${x.id}`, label: `${x.barcode} · ${x.name}`, subtitle: `${x.karat} · ${grams(x.netMg)} · ${x.categoryName}` }))
                .concat(
                  line.oldGold
                    .filter((x) => !taken.has(x.id))
                    .map((x) => ({ value: `o:${x.id}`, label: `${x.number} · ${x.description} (old gold)`, subtitle: `${x.karat ?? ""} · ${grams(x.netMg)}` }))
                )
            : []
        }
        onPick={(v) => {
          const i = picking!;
          const l = s!.lines[i]!;
          const product = [l.product, ...l.candidates].find((x) => x && `p:${x.id}` === v) ?? null;
          const og = l.oldGold.find((x) => `o:${x.id}` === v) ?? null;
          const next: Pick = product ? { kind: "product", product } : og ? { kind: "oldgold", item: og } : null;
          setPicks((cur) => cur.map((x, j) => (j === i ? next : x)));
          setPicking(null);
        }}
      />
      <OptionSheet
        visible={catFor !== null}
        onClose={() => setCatFor(null)}
        title="Category for the new product"
        value={catFor !== null ? (cats[catFor] ?? "") : ""}
        options={(s?.categories ?? []).map((x) => ({ value: x.id, label: x.name }))}
        onPick={(v) => {
          const i = catFor!;
          setCats((cur) => cur.map((x, j) => (j === i ? v || null : x)));
          setCatFor(null);
        }}
      />
    </Sheet>
  );
}
