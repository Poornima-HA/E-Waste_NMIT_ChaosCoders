import { useEffect, useState } from "react";
import { Atom, CheckCircle2, Cpu, Play, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../api";
import type { OptResult, OptRun, PlanCheck, QBench, Receipt, Scenario } from "../api";

const card = "rounded-lg border border-slate-200 bg-white";
const btn = "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm text-white disabled:opacity-50";
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function placedKg(p: PlanCheck) {
  return Object.values(p.load_kg).reduce((s, v) => s + v, 0);
}

function Bar({ used, cap }: { used: number; cap: number }) {
  const pct = Math.min(100, (used / cap) * 100);
  return (
    <div className="h-2 w-full rounded bg-slate-100">
      <div className={`h-2 rounded ${used > cap ? "bg-red-500" : "bg-slate-700"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function DispatchOptimizer() {
  const [scn, setScn] = useState<Scenario | null>(null);
  const [res, setRes] = useState<OptResult | null>(null);
  const [bench, setBench] = useState<QBench[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [s, runs, qb] = await Promise.all([
      api<Scenario>("/api/v1/optimization/scenario"),
      api<OptRun[]>("/api/v1/optimization/runs"),
      api<QBench[]>("/api/v1/optimization/quantum-benchmarks"),
    ]);
    setScn(s);
    setBench(qb);
    if (runs[0]) setRes(await api<OptResult>(`/api/v1/optimization/runs/${runs[0].id}`));
  };

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const runId = res?.run_id ?? res?.id;
  const status = res?.status ?? "proposed";

  const solve = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<OptResult>("/api/v1/optimization/solve?mode=local", { method: "POST" });
      setRes({ ...r, status: "proposed" });
      setMsg({ ok: true, text: `QpiAI Opt run ${r.run_id} completed` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!runId || !res) return;
    setBusy(true);
    setMsg(null);
    try {
      const a = await api<{ run_id: string; run_status: string; receipt: Receipt }>(
        `/api/v1/optimization/runs/${runId}/approve`, { method: "POST" });
      setRes({ ...res, status: a.run_status });
      setMsg({
        ok: true,
        text: `Plan approved · anchor ${a.receipt.status} on ${a.receipt.network}` +
          (a.receipt.note ? ` · ${a.receipt.note}` : "") +
          (a.receipt.tx_hash ? ` · tx ${a.receipt.tx_hash.slice(0, 14)}…` : ""),
      });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const costOf = (b: string, f?: string) =>
    f ? res?.cost_matrix_inr.find((c) => c.batch === b && c.facility === f)?.cost : undefined;

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dispatch optimizer</h1>
          <p className="text-sm text-slate-500">
            Assign batches to licensed recyclers at minimum cost · solved with <b>QpiAI Opt</b> (MILP)
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={solve} disabled={busy} className={`${btn} bg-slate-900 hover:bg-slate-800`}>
            <Play size={14} /> {busy ? "Solving…" : "Run QpiAI Opt"}
          </button>
          {res && status !== "approved" && res.optimized.feasible && (
            <button onClick={approve} disabled={busy} className={`${btn} bg-emerald-700 hover:bg-emerald-600`}>
              <ShieldCheck size={14} /> Approve &amp; anchor plan
            </button>
          )}
          {status === "approved" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 size={14} /> Approved &amp; anchored
            </span>
          )}
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {msg.text}
        </div>
      )}

      {!res ? (
        <div className={`${card} p-8 text-center text-slate-500`}>No optimization run yet. Click <b>Run QpiAI Opt</b>.</div>
      ) : (
        <>
          {/* solver evidence */}
          <div className={`${card} p-4`}>
            <h2 className="flex items-center gap-2 font-medium"><Cpu size={16} /> Solver execution evidence</h2>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div><div className="text-xs text-slate-500">Product</div>{res.solver.product}</div>
              <div><div className="text-xs text-slate-500">Class · mode</div>{res.solver.problem_class} · {res.solver.execution_mode}</div>
              <div><div className="text-xs text-slate-500">Termination</div>{res.solver.termination}</div>
              <div><div className="text-xs text-slate-500">Guarantee</div><b>{res.solver.guarantee}</b></div>
              <div><div className="text-xs text-slate-500">Solve / wall time</div>
                {res.solver.solver_time_s?.toFixed(3) ?? "—"}s / {res.solver.wall_time_s}s</div>
              <div><div className="text-xs text-slate-500">Independent cost check</div>
                {res.objective_matches_independent_cost
                  ? <span className="text-emerald-700">✔ objective matches</span>
                  : <span className="text-red-700">✖ mismatch</span>}</div>
            </div>
            <p className="mt-3 font-mono text-xs text-slate-500">
              Run {runId} · plan hash {res.plan_hash} · {res.excluded_pairs.length} ineligible pairs removed as hard constraints
            </p>
          </div>

          {/* comparison */}
          <div className="grid gap-4 md:grid-cols-2">
            {([["QpiAI Opt (optimized)", res.optimized, true], ["Nearest-facility baseline", res.baseline_nearest, false]] as const).map(
              ([label, p, isOpt]) => {
                const kg = placedKg(p);
                return (
                  <div key={label} className={`${card} p-4 ${isOpt ? "ring-2 ring-slate-900" : ""}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{label}</h3>
                      {p.feasible
                        ? <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={14} /> feasible</span>
                        : <span className="inline-flex items-center gap-1 text-sm text-red-700"><XCircle size={14} /> infeasible</span>}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div><div className="text-xs text-slate-500">Batches placed</div><b>{p.assigned}/{p.total_batches}</b></div>
                      <div><div className="text-xs text-slate-500">Total cost</div><b>{inr(p.total_cost_inr)}</b></div>
                      <div><div className="text-xs text-slate-500">Cost per kg placed</div><b>{kg ? inr(p.total_cost_inr / kg) : "—"}</b></div>
                    </div>
                    {p.violations.length > 0 && (
                      <ul className="mt-3 list-disc pl-5 text-sm text-red-700">
                        {p.violations.map((v) => <li key={v}>{v}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })}
          </div>

          {/* plan table */}
          <div className={card}>
            <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Assignment plan</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Batch</th><th className="px-4 py-2">Source · category · mass</th>
                  <th className="px-4 py-2">QpiAI Opt</th><th className="px-4 py-2">Baseline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scn?.batches.map((b) => {
                  const o = res.optimized.plan[b.id]?.[0];
                  const base = res.baseline_nearest.plan[b.id]?.[0];
                  return (
                    <tr key={b.id} className={o !== base ? "bg-amber-50/50" : ""}>
                      <td className="px-4 py-2 font-medium">{b.id}</td>
                      <td className="px-4 py-2">{b.source} · {b.category} · {b.mass_kg} kg</td>
                      <td className="px-4 py-2"><b>{o ?? "—"}</b>{o && <span className="ml-2 text-slate-500">{inr(costOf(b.id, o) ?? 0)}</span>}</td>
                      <td className="px-4 py-2">
                        {base ? <>{base}<span className="ml-2 text-slate-500">{inr(costOf(b.id, base) ?? 0)}</span></>
                          : <span className="font-medium text-red-700">UNASSIGNED</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-2 text-xs text-slate-500">Highlighted rows: the optimizer chose differently from the greedy baseline.</p>
          </div>

          {/* capacity */}
          <div className={`${card} p-4`}>
            <h2 className="font-medium">Facility capacity & eligibility</h2>
            <div className="mt-3 space-y-3">
              {scn?.facilities.map((f) => {
                const expired = f.licence_valid_until < res.as_of;
                const used = res.optimized.load_kg[f.id] ?? 0;
                return (
                  <div key={f.id} className="grid grid-cols-12 items-center gap-3 text-sm">
                    <div className="col-span-3"><b>{f.id}</b> <span className="text-slate-500">{f.name}</span></div>
                    <div className="col-span-6">
                      {expired
                        ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Excluded: licence expired {f.licence_valid_until}</span>
                        : <Bar used={used} cap={f.capacity_kg} />}
                    </div>
                    <div className="col-span-3 text-right text-slate-600">
                      {expired ? "0 kg assigned" : `${used.toLocaleString()} / ${f.capacity_kg.toLocaleString()} kg`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* quantum benchmark */}
      <div className={`${card} p-4`}>
        <h2 className="flex items-center gap-2 font-medium"><Atom size={16} /> Quantum benchmark: QAOA on the same formulation</h2>
        <p className="mt-1 text-xs text-slate-500">
          Sub-instance solved three ways: exhaustive brute force (ground truth), QpiAI Opt MILP, and QAOA via the QpiAI Quantum SDK.
          QAOA results are heuristic (<i>best_found</i>), never claimed as proven optimal.
        </p>
        {bench.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No QAOA evidence files found.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-2">Run</th><th>Backend</th><th>Qubits · depth</th>
                <th>Brute force</th><th>MILP</th><th>QAOA</th><th>Matches optimum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bench.map((q) => (
                <tr key={q.file}>
                  <td className="py-2 font-mono text-xs">{q.file}</td>
                  <td>{q.backend ?? q.device}{q.job_ids.length > 0 && <span className="ml-1 text-xs text-slate-500">({q.job_ids.length} cloud jobs)</span>}</td>
                  <td>{q.qubits} · {q.depth}</td>
                  <td>{inr(q.brute_force_cost_inr)}</td>
                  <td>{inr(q.milp_cost_inr)} <span className="text-xs text-slate-500">{q.milp_guarantee}</span></td>
                  <td>{q.feasible ? inr(q.cost_inr) : <span className="text-red-700">infeasible</span>} <span className="text-xs text-slate-500">{q.guarantee}</span></td>
                  <td>{q.matches_optimum ? <span className="text-emerald-700">✔ yes</span> : <span className="text-amber-700">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          QCloud platform execution: pending experiment setup with QpiAI (see docs/qpiai-execution-log.md).
        </p>
      </div>
    </div>
  );
}