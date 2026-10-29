import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { api } from "../api";
import type { Audits, ClaimsList } from "../api";

const card = "rounded-lg border border-slate-200 bg-white";
const ghost = "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100";

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
  const [severity, setSeverity] = useState("all");
  const [rule, setRule] = useState("all");
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [a, c] = await Promise.all([api<Audits>("/api/v1/audits"), api<ClaimsList>("/api/v1/claims")]);
    setAudits(a);
    setClaims(c);
  };

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <div className="p-8 text-red-700">{err}</div>;
  if (!audits || !claims) return <div className="p-8 text-slate-500">Loading audit findings…</div>;

  const rules = Array.from(new Set(audits.alerts.map((a) => a.rule)));
  const shown = audits.alerts.filter(
    (a) => (severity === "all" || a.severity === severity) && (rule === "all" || a.rule === rule));
  const counts = rules.map((r) => ({ r, n: audits.alerts.filter((a) => a.rule === r).length }));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit centre</h1>
          <p className="text-sm text-slate-500">Every discrepancy, with the rule, the measured values and the batch trail</p>
        </div>
        <div className="flex gap-2">
          <button className={ghost} onClick={load}>Refresh</button>
          <button className={ghost} onClick={() => download(`audit-alerts-${stamp}.csv`, toCsv(audits.alerts))}>
            <Download size={14} /> Alerts CSV
          </button>
          <button className={ghost} onClick={() => download(`claim-decisions-${stamp}.csv`, toCsv(claims.attempts))}>
            <Download size={14} /> Claim log CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {counts.map(({ r, n }) => (
          <button key={r} onClick={() => setRule(rule === r ? "all" : r)}
            className={`rounded-full border px-3 py-1 text-xs ${rule === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
            {r} · {n}
          </button>
        ))}
        <select className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
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
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">Severity</th><th>Rule</th><th>Batch</th><th>Finding</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${a.severity === "critical" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-xs">{a.rule}</td>
                  <td className="py-2">
                    <Link to={`/batches/${a.batch_id}`} className="text-blue-700 hover:underline">{a.batch_id}</Link>
                  </td>
                  <td className="py-2 pr-4">{a.message}</td>
                  <td className="py-2 pr-4 text-xs">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
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