import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { api } from "../api";
import type { Facility, InvRow, Reconciliation } from "../api";

const card = "rounded-lg border border-slate-200 bg-white";
const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const th = "px-3 py-2";
const td = "px-3 py-3";
const TONE: Record<string, string> = {
  reconciled: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
  not_counted: "bg-slate-100 text-slate-600",
};

export default function Inventory() {
  const [rec, setRec] = useState<Reconciliation | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    facility_id: "F1", material: "copper", kg: "", counted_by: "auditor-meera",
    method: "platform_scale", evidence_ref: "Stock count sheet SC-F1-001",
  });

  const load = async () => {
    const [r, f] = await Promise.all([
      api<Reconciliation>("/api/v1/inventory/reconciliation"),
      api<Facility[]>("/api/v1/facilities"),
    ]);
    setRec(r);
    setFacilities(f);
  };

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const pick = (r: InvRow) => {
    setForm({
      ...form,
      facility_id: r.facility_id,
      material: r.material,
      kg: "",
      evidence_ref: `Stock count sheet SC-${r.facility_id}-${Date.now().toString().slice(-4)}`,
    });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ count_id: number; row: InvRow | null }>("/api/v1/inventory/counts", {
        method: "POST",
        body: JSON.stringify({
          facility_id: form.facility_id, material: form.material,
          counted: { value: Number(form.kg), unit: "kg" }, counted_by: form.counted_by,
          method: form.method, evidence_ref: form.evidence_ref,
        }),
      });
      const st = res.row?.status ?? "recorded";
      setMsg({
        ok: st === "reconciled",
        text: `Count #${res.count_id} recorded: ${form.facility_id} · ${form.material} is now ${st.toUpperCase()}`,
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!rec) return <div className="p-8 text-slate-500">{msg ? msg.text : "Reconciling inventory…"}</div>;

  const counts = (["critical", "warning", "reconciled", "not_counted"] as const).map((s) => ({
    s, n: rec.rows.filter((r) => r.status === s).length,
  }));

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Inventory reconciliation</h1>
        <p className="text-sm text-slate-500">
          System records vs independent physical counts vs declared claims · tolerance ≤ {rec.tolerance.pass_pct}%,
          critical &gt; {rec.tolerance.critical_pct}% ({rec.tolerance.note})
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {counts.map(({ s, n }) => (
          <span key={s} className={`rounded-full px-3 py-1 text-xs ${TONE[s]}`}>
            {s.replace("_", " ")} · {n}
          </span>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {msg.text}
        </div>
      )}

      {/* count entry */}
      <div className={`${card} p-4`}>
        <h2 className="flex items-center gap-2 font-medium">
          <ClipboardCheck size={16} /> Record independent physical count
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-500">Facility
            <select className={input} value={form.facility_id}
              onChange={(e) => setForm({ ...form, facility_id: e.target.value })}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Material
            <input className={input} list="materials" value={form.material}
              onChange={(e) => setForm({ ...form, material: e.target.value })} />
            <datalist id="materials">
              {Array.from(new Set(rec.rows.map((r) => r.material))).map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>
          <label className="text-xs text-slate-500">Counted kg
            <input className={input} type="number" value={form.kg}
              onChange={(e) => setForm({ ...form, kg: e.target.value })} />
          </label>
          <label className="text-xs text-slate-500">Method
            <select className={input} value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="platform_scale">platform scale</option>
              <option value="weighbridge">weighbridge</option>
              <option value="visual_estimate">visual estimate</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">Counted by
            <input className={input} value={form.counted_by}
              onChange={(e) => setForm({ ...form, counted_by: e.target.value })} />
          </label>
          <label className="text-xs text-slate-500 md:col-span-2">Evidence reference (hashed with SHA-256)
            <input className={input} value={form.evidence_ref}
              onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} />
          </label>
          <div className="flex items-end">
            <button disabled={busy || !form.kg || form.evidence_ref.length < 3} onClick={submit}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? "Saving…" : "Record count"}
            </button>
          </div>
        </div>
      </div>

      {/* reconciliation table */}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className={`${th} w-[38%]`}>Facility · material</th>
              <th className={th}>System</th>
              <th className={th}>Disputed</th>
              <th className={th}>Claimed</th>
              <th className={th}>Physical</th>
              <th className={th}>Difference</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rec.rows.map((r) => (
              <tr key={`${r.facility_id}-${r.material}`} className="align-top">
                <td className={td}>
                  <b>{r.facility_id}</b> · <span className="capitalize">{r.material}</span>
                  {r.findings.map((f) => (
                    <p key={f.rule}
                      className={`mt-1 text-xs ${f.severity === "critical" ? "text-red-700" : "text-amber-700"}`}>
                      <b>{f.rule}</b>: {f.message}
                    </p>
                  ))}
                  {r.last_count && (
                    <p className="mt-1 text-xs text-slate-400">
                      Last count by {r.last_count.counted_by} ({r.last_count.method.replace("_", " ")})
                      · sha256 {r.last_count.evidence_hash.slice(0, 10)}…
                    </p>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>{r.system_kg} kg</td>
                <td className={`${td} whitespace-nowrap`}>
                  {r.disputed_kg ? <span className="text-amber-700">{r.disputed_kg} kg</span> : "—"}
                </td>
                <td className={`${td} whitespace-nowrap`}>{r.claimed_kg ? `${r.claimed_kg} kg` : "—"}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {r.physical_kg === null
                    ? <span className="text-slate-400">not counted</span>
                    : `${r.physical_kg} kg`}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {r.difference_kg === null ? "—" : (
                    <span className={r.status === "reconciled" ? "" : "font-medium text-red-700"}>
                      {r.difference_kg > 0 ? "+" : ""}{r.difference_kg} kg ({r.difference_pct}%)
                    </span>
                  )}
                </td>
                <td className={td}>
                  <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${TONE[r.status]}`}>
                    {r.status.replace("_", " ")}
                  </span>
                </td>
                <td className={td}>
                  <button onClick={() => pick(r)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">
                    Count
                  </button>
                </td>
              </tr>
            ))}
            {rec.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">No stock recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}