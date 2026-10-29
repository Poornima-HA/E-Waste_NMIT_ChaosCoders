import MaterialFlow from "../MaterialFlow";
import HeroStrip from "../HeroStrip";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Package, Scale, Truck } from "lucide-react";
import { api } from "../api";
import type { Audits, BatchSummary, ChainStatus, Facility, OptRun } from "../api";

type Data = {
  batches: BatchSummary[];
  audits: Audits;
  facilities: Facility[];
  runs: OptRun[];
  chain: ChainStatus | null;
  chainError: string | null;
};

function Kpi({ label, value, sub, icon, tone = "slate" }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  tone?: "slate" | "amber" | "red" | "green";
}) {
  const tones = {
    slate: "text-slate-700 bg-slate-100",
    amber: "text-amber-700 bg-amber-100",
    red: "text-red-700 bg-red-100",
    green: "text-emerald-700 bg-emerald-100",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <span className={`rounded-md p-1.5 ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [batches, audits, facilities, runs] = await Promise.all([
        api<BatchSummary[]>("/api/v1/batches"),
        api<Audits>("/api/v1/audits"),
        api<Facility[]>("/api/v1/facilities"),
        api<OptRun[]>("/api/v1/optimization/runs"),
      ]);
      let chain: ChainStatus | null = null;
      let chainError: string | null = null;
      try {
        chain = await api<ChainStatus>("/api/v1/blockchain/status");
      } catch (e) {
        chainError = (e as Error).message;
      }
      setData({ batches, audits, facilities, runs, chain, chainError });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (error)
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          Backend unreachable: {error}. Is uvicorn running on port 8000?
        </div>
      </div>
    );
  if (!data) return <div className="p-8 text-slate-500">Loading operations data…</div>;

  const totalKg = data.batches.reduce((s, b) => s + b.net_mass_kg, 0);
  const inTransit = data.batches.filter((b) => b.status === "in_transit").length;
  const openAlerts = data.audits.alerts.filter((a) => a.status === "open");
  const critical = openAlerts.filter((a) => a.severity === "critical").length;
  const processors = data.facilities.filter((f) => f.kind === "processor");
  const licenceIssues = processors.filter((f) => f.licence_valid === false).length;
  const latestRun = data.runs[0];

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Operations overview</h1>
          <p className="text-sm text-slate-500">Live data from the E-Waste Ledger API</p>
        </div>
        <button onClick={load}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">
          Refresh
        </button>
      </div>
      <HeroStrip />
      {data.chain && !data.chain.public && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠ Blockchain is running in <b>local demo mode</b> ({data.chain.network}). Anchors are real
          contract transactions, but not on a public network.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Registered batches" value={String(data.batches.length)} icon={<Package size={16} />} />
        <Kpi label="Collected mass" value={`${totalKg.toLocaleString()} kg`} icon={<Scale size={16} />} />
        <Kpi label="In transit" value={String(inTransit)} sub="awaiting receipt"
          icon={<Truck size={16} />} tone={inTransit ? "amber" : "slate"} />
        <Kpi label="Open alerts" value={String(openAlerts.length)} sub={`${critical} critical`}
          icon={<AlertTriangle size={16} />} tone={critical ? "red" : openAlerts.length ? "amber" : "green"} />
        <Kpi label="Licence issues" value={`${licenceIssues}/${processors.length}`} sub="processors"
          icon={<CheckCircle2 size={16} />} tone={licenceIssues ? "amber" : "green"} />
        <Kpi label="Audit chain" value={data.chain ? `Block ${data.chain.latest_block}` : "Offline"}
          sub={data.chain ? data.chain.network : data.chainError ?? ""}
          icon={<Link2 size={16} />} tone={data.chain ? (data.chain.public ? "green" : "amber") : "red"} />
      </div>

      <MaterialFlow />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Audit alerts</h2>
          {openAlerts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No open alerts.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {openAlerts.map((a) => (
                <li key={a.id} className="p-4">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                      a.severity === "critical" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                      {a.severity}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{a.rule}</span>
                    <span className="ml-auto text-sm font-medium">{a.batch_id}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Facility compliance</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Facility</th>
                <th className="px-4 py-2">Capacity</th>
                <th className="px-4 py-2">Licence until</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {processors.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-2"><b>{f.id}</b> <span className="text-slate-500">{f.name}</span></td>
                  <td className="px-4 py-2">{(f.capacity_g / 1000).toLocaleString()} kg</td>
                  <td className="px-4 py-2">{f.licence_valid_until ?? "—"}</td>
                  <td className="px-4 py-2">
                    {f.licence_valid ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Valid (demo)</span>
                    ) : (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Expired: blocked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Latest dispatch optimization (QpiAI Opt)</h2>
        {latestRun ? (
          <p className="mt-2 text-sm text-slate-700">
            Run <b>{latestRun.id}</b> · mode {latestRun.mode} · status{" "}
            <span className="font-medium">{latestRun.status}</span> · plan hash{" "}
            <span className="font-mono text-xs">{latestRun.plan_hash.slice(0, 16)}…</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No optimization runs yet.</p>
        )}
      </section>
    </div>
  );
}