import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { BatchSummary, Facility } from "../api";

const STATUS: Record<string, string> = {
  collected: "bg-slate-100 text-slate-700",
  in_transit: "bg-amber-100 text-amber-800",
  received: "bg-emerald-100 text-emerald-800",
};

function nextId(batches: BatchSummary[]) {
  const nums = batches
    .map((b) => /^EW-2026-(\d{4})$/.exec(b.id))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  return `EW-2026-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`;
}

export default function Batches() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [sources, setSources] = useState<Facility[]>([]);
  const [form, setForm] = useState({ id: "", source: "CC-A", category: "IT", kg: "", operator: "op-ravi" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [b, f] = await Promise.all([
      api<BatchSummary[]>("/api/v1/batches"),
      api<Facility[]>("/api/v1/facilities"),
    ]);
    setBatches(b);
    setSources(f.filter((x) => x.kind === "collection"));
    setForm((prev) => (prev.id ? prev : { ...prev, id: nextId(b) }));
  };

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/v1/batches", {
        method: "POST",
        body: JSON.stringify({
          id: form.id, source_facility_id: form.source, category: form.category,
          mass: { value: Number(form.kg), unit: "kg" }, operator: form.operator,
          weighed_at: new Date().toISOString().slice(0, 19),
        }),
      });
      setMsg({ ok: true, text: `${form.id} registered and hash-chained` });
      setForm({ ...form, id: "", kg: "" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Batches</h1>

      <form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-6">
        <label className="text-xs text-slate-500">Batch ID
          <input className={input} value={form.id} onChange={set("id")} required />
        </label>
        <label className="text-xs text-slate-500">Source
          <select className={input} value={form.source} onChange={set("source")}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Category
          <select className={input} value={form.category} onChange={set("category")}>
            <option>IT</option><option>TELECOM</option><option>CONSUMER</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">Weighed mass (kg)
          <input className={input} type="number" min="0.001" step="0.001" value={form.kg} onChange={set("kg")} required />
        </label>
        <label className="text-xs text-slate-500">Operator
          <input className={input} value={form.operator} onChange={set("operator")} required />
        </label>
        <div className="flex items-end">
          <button disabled={busy} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? "Registering…" : "Register batch"}
          </button>
        </div>
        {msg && (
          <p className={`text-sm md:col-span-6 ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>
        )}
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Batch</th><th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Mass</th><th className="px-4 py-2">Custodian</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batches.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link to={`/batches/${b.id}`} className="font-medium text-blue-700 hover:underline">{b.id}</Link>
                </td>
                <td className="px-4 py-2">{b.category}</td>
                <td className="px-4 py-2">{b.net_mass_kg.toLocaleString()} kg</td>
                <td className="px-4 py-2">{b.custodian}</td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS[b.status] ?? "bg-slate-100"}`}>{b.status}</span>
                </td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No batches yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}