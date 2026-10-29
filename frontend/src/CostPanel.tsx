import { useEffect, useState } from "react";
import { IndianRupee } from "lucide-react";
import { api } from "./api";
import type { CostSummary } from "./api";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function CostPanel({ batchId }: { batchId: string }) {
  const [s, setS] = useState<CostSummary | null>(null);
  const [category, setCategory] = useState("transport");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<CostSummary>(`/api/v1/costs/batch/${batchId}`).then(setS).catch((e) => setErr((e as Error).message));

  useEffect(() => {
    load();
  }, [batchId]);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      setS(await api<CostSummary>("/api/v1/costs", {
        method: "POST",
        body: JSON.stringify({
          batch_id: batchId, category, amount_inr: Number(amount),
          reference, recorded_by: "finance-desk",
        }),
      }));
      setAmount("");
      setReference("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 font-medium"><IndianRupee size={16} /> Batch cost</h2>
      {s && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-7">
          {(["transport", "processing", "disposal", "handling"] as const).map((c) => (
            <div key={c}><div className="text-xs capitalize text-slate-500">{c}</div>{inr(s.by_category_inr[c])}</div>
          ))}
          <div><div className="text-xs text-slate-500">Total</div><b>{inr(s.total_inr)}</b></div>
          <div><div className="text-xs text-slate-500">Per kg collected</div>
            <b>{s.cost_per_kg_collected_inr !== null ? inr(s.cost_per_kg_collected_inr) : "—"}</b></div>
          <div><div className="text-xs text-slate-500">Per kg recovered</div>
            <b>{s.cost_per_kg_recovered_inr !== null ? inr(s.cost_per_kg_recovered_inr) : "not processed"}</b></div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="transport">transport</option>
          <option value="processing">processing</option>
          <option value="disposal">disposal</option>
          <option value="handling">handling</option>
        </select>
        <input className={`${input} w-32`} type="number" placeholder="₹ amount" value={amount}
          onChange={(e) => setAmount(e.target.value)} />
        <input className={`${input} flex-1`} placeholder="Invoice / reference" value={reference}
          onChange={(e) => setReference(e.target.value)} />
        <button disabled={busy || !amount || reference.length < 3} onClick={add}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
          Add cost
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {s && s.records.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {s.records.map((r) => (
            <li key={r.id} className="flex gap-3 py-1.5">
              <span className="w-24 capitalize text-slate-500">{r.category}</span>
              <span className="w-28">{inr(r.amount_inr)}</span>
              <span className="text-slate-600">{r.reference}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}