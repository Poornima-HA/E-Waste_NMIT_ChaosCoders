import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { api } from "../api";
import type { Audits, ClaimsList, Resolution } from "../api";

const card = "rounded-lg border border-slate-200 bg-white";
const ghost = "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100";
const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const STATUS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  investigating: "bg-amber-100 text-amber-800",
  resolved: "bg-emerald-100 text-emerald-800",
  false_positive: "bg-slate-100 text-slate-700",
};

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditCentre() {
  const [audits, setAudits] = useState<Audits | null>(null);
  const [claims, setClaims] = useState<ClaimsList | null>(null);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [severity, setSeverity] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [rule, setRule] = useState("all");
  const [err, setErr] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [form, setForm] = useState({ status: "investigating", note: "", reviewer: "auditor-meera" });
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = async () => {
    const [a, c, r] = await Promise.all([
      api<Audits>("/api/v1/audits"),
      api<ClaimsList>("/api/v1/claims"),
      api<Resolution[]>("/api/v1/audits/resolutions"),
    ]);
    setAudits(a);
    setClaims(c);
    setResolutions(r);
  };

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, []);

  const submitReview = async (alertId: number) => {
    setFormErr(null);
    try {
      await api(`/api/v1/audits/alerts/${alertId}/resolve`, { method: "POST", body: JSON.stringify(form) });
      setReviewing(null);
      setForm({ ...form, note: "" });
      await load();
    } catch (e) {
      setFormErr((e as Error).message);
    }
  };

  if (err) return <div className="p-8 text-red-700">{err}</div>;
  if (!audits || !claims) return <div className="p-8 text-slate-500">Loading audit findings…</div>;

  const rules = Array.from(new Set(audits.alerts.map((a) => a.rule)));
  const shown = audits.alerts.filter((a) =>
    (severity === "all" || a.severity === severity) &&
    (statusF === "all" || a.status === statusF) &&
    (rule === "all" || a.rule === rule));
  const counts = rules.map((r) => ({ r, n: audits.alerts.filter((a) => a.rule === r).length }));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const historyOf = (id: number) => resolutions.filter((r) => r.alert_id === id);

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit centre</h1>
          <p className="text-sm text-slate-500">Every discrepancy with its rule, measured values, investigation trail and batch link</p>
        </div>
        <div className="flex gap-2">
          <button className={ghost} onClick={load}>Refresh</button>
          <button className={ghost} onClick={() => download(`audit-alerts-${stamp}.csv`, toCsv(audits.alerts))}>
            <Download size={14} /> Alerts CSV
          </button>
          <button className={ghost} onClick={() => download(`alert-reviews-${stamp}.csv`, toCsv(resolutions))}>
            <Download size={14} /> Review log CSV
          </button>
          <button className={ghost} onClick={() => download(`claim-decisions-${stamp}.csv`, toCsv(claims.attempts))}>
            <Download size={14} /> Claim log CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {counts.map(({ r, n }) => (
          <button key={r} onClick={() => setRule(rule === r ? "all" : r)}
            className={`rounded-full border px-3 py-1 text-xs ${rule === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
            {r} · {n}
          </button>
        ))}
        <select className={`${input} ml-auto`} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="false_positive">False positive</option>
        </select>
        <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
        </select>
      </div>

      <div className={card}>
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Audit alerts ({shown.length})</h2>
        {shown.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No alerts match the filter.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((a) => {
              const hist = historyOf(a.id);
              const closed = a.status === "resolved" || a.status === "false_positive";
              return (
                <li key={a.id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${a.severity === "critical" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                      {a.severity}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{a.rule}</span>
                    <Link to={`/batches/${a.batch_id}`} className="text-blue-700 hover:underline">{a.batch_id}</Link>
                    <span className={`ml-auto rounded px-2 py-0.5 text-xs ${STATUS[a.status] ?? "bg-slate-100"}`}>
                      {a.status.replace("_", " ")}
                    </span>
                    {!closed && reviewing !== a.id && (
                                            <button className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                        onClick={() => {
                          setReviewing(a.id);
                          setFormErr(null);
                          setForm({ ...form, note: "", status: a.status === "open" ? "investigating" : "resolved" });
                        }}>
                        Review
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-slate-700">{a.message}</p>

                  {hist.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 text-xs text-slate-600">
                      {hist.map((h) => (
                        <li key={h.id}>
                          <b>{h.from} → {h.to}</b> by {h.reviewer} · {h.at.replace("T", " ").slice(0, 16)}: {h.note}
                        </li>
                      ))}
                    </ul>
                  )}

                  {reviewing === a.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3">
                      <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {a.status === "open" && <option value="investigating">investigating</option>}
                        <option value="resolved">resolved</option>
                        <option value="false_positive">false positive</option>
                      </select>
                      <input className={`${input} min-w-[280px] flex-1`} placeholder="Finding / action taken (min 10 characters)"
                        value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                      <input className={`${input} w-40`} value={form.reviewer}
                        onChange={(e) => setForm({ ...form, reviewer: e.target.value })} />
                      <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                        disabled={form.note.trim().length < 10} onClick={() => submitReview(a.id)}>
                        Save review
                      </button>
                      <button className="text-xs text-slate-500" onClick={() => setReviewing(null)}>cancel</button>
                      {formErr && <p className="w-full text-xs text-red-700">{formErr}</p>}
                      <p className="w-full text-xs text-slate-400">
                        Recorded permanently in the batch's hash chain. Original measurements are never changed.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={card}>
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Missing / overdue handovers</h2>
        {audits.missing_handovers.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No dispatched transfer is overdue for receipt.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {audits.missing_handovers.map((h) => (
              <li key={h.transfer_id} className="p-4 text-sm">
                <span className="mr-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">no receipt</span>
                <b>{h.transfer_id}</b> · <Link to={`/batches/${h.batch_id}`} className="text-blue-700 hover:underline">{h.batch_id}</Link>
                {" "}→ {h.to} · dispatched {h.dispatched_at.replace("T", " ").slice(0, 19)}. Excluded from confirmed inventory.
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}