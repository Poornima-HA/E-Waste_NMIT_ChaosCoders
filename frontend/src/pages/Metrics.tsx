import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import type { Metrics } from "../api";

type Tone = "slate" | "green" | "amber" | "red";
const TONE: Record<Tone, string> = {
  slate: "border-slate-200",
  green: "border-emerald-300 bg-emerald-50",
  amber: "border-amber-300 bg-amber-50",
  red: "border-red-300 bg-red-50",
};

function Tile({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className={`rounded-lg border bg-white p-4 ${TONE[tone]}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

const kg = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

export default function MetricsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<Metrics>("/api/v1/metrics").then(setM).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  if (err) return <div className="p-8 text-red-700">{err}</div>;
  if (!m) return <div className="p-8 text-slate-500">Computing metrics…</div>;

  const o = m.optimization;
  const t = m.tests;

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Impact &amp; evidence</h1>
          <p className="text-sm text-slate-500">Every figure computed live from the ledger and saved evidence files</p>
        </div>
        <button onClick={load} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">
          Refresh
        </button>
      </div>

      <Section title="Fraud & error prevention">
        <Tile label="Invalid claims blocked" value={String(m.claims.blocked)} sub={`${kg(m.claims.blocked_kg)} of false recovery prevented`}
          tone={m.claims.blocked ? "green" : "slate"} />
        <Tile label="Weight disputes caught" value={String(m.custody.disputed)} sub={`${kg(m.custody.total_receipt_gap_kg)} total receipt gap`}
          tone={m.custody.disputed ? "amber" : "slate"} />
        <Tile label="Missing handovers" value={String(m.custody.missing_handovers)} sub="dispatched, never received"
          tone={m.custody.missing_handovers ? "amber" : "slate"} />
        <Tile label="Critical mass balances" value={String(m.mass_balance.critical)} sub={`of ${m.mass_balance.runs} processing runs`}
          tone={m.mass_balance.critical ? "red" : "green"} />
      </Section>
      {Object.keys(m.claims.blocked_by_rule).length > 0 && (
        <div className="-mt-5 flex flex-wrap gap-2">
          {Object.entries(m.claims.blocked_by_rule).map(([r, n]) => (
            <span key={r} className="rounded-full bg-red-100 px-3 py-1 text-xs text-red-800">{r} · {n}</span>
          ))}
        </div>
      )}

      <Section title="Material accountability">
        <Tile label="Collected (original batches)" value={kg(m.operations.collected_kg)} sub={`${m.operations.original_batches} original · ${m.operations.batches} incl. split/merge`} />
        <Tile label="Processed input" value={kg(m.operations.processed_input_kg)} />
        <Tile label="Recovered material" value={kg(m.operations.recovered_kg)}
          sub={m.operations.avg_yield_pct !== null ? `${m.operations.avg_yield_pct}% average yield` : undefined} />
        <Tile label="Unexplained mass" value={kg(m.mass_balance.unexplained_kg)} sub="sum of run variances, investigated per run" />
      </Section>

      <Section title="QpiAI Opt dispatch optimization">
        <Tile label="Solver guarantee" value={o?.guarantee ?? "—"} sub={o ? `run ${o.run_id} · ${o.status}` : "no run yet"}
          tone={o?.guarantee === "global_optimum" ? "green" : "slate"} />
        <Tile label="Batches placed" value={o ? `${o.optimized_assigned} vs ${o.baseline_assigned}` : "—"} sub="optimized vs nearest-facility baseline"
          tone={o && !o.baseline_feasible && o.optimized_feasible ? "green" : "slate"} />
        <Tile label="Cost per kg placed" value={o ? `${inr(o.optimized_inr_per_kg)} vs ${inr(o.baseline_inr_per_kg)}` : "—"} sub="optimized vs baseline" />
        <Tile label="Per-kg saving" value={o?.per_kg_saving_pct !== undefined ? `${o.per_kg_saving_pct}%` : "—"}
          sub="while placing every batch" tone={o?.per_kg_saving_pct ? "green" : "slate"} />
      </Section>

      <Section title="Quantum benchmark (QpiAI Quantum SDK)">
        <Tile label="QAOA benchmark runs" value={String(m.quantum.benchmarks)} />
        <Tile label="Matched exact optimum" value={`${m.quantum.matches_optimum}/${m.quantum.benchmarks}`} sub="vs MILP + brute force"
          tone={m.quantum.matches_optimum ? "green" : "slate"} />
        <Tile label="QCloud jobs executed" value={String(m.quantum.cloud_jobs)}
          sub={m.quantum.cloud_jobs ? "on QpiAI QCloud" : "circuit uploaded; execution awaits subscription"}
          tone={m.quantum.cloud_jobs ? "green" : "amber"} />
        <Tile label="Result claim" value="best_found" sub="heuristic, never claimed as proven optimal" />
      </Section>

      <Section title="Blockchain integrity">
        <Tile label="Hash-chained events" value={String(m.blockchain.events)} />
        <Tile label="Anchored on-chain" value={String(m.blockchain.anchored_events)}
          sub={m.blockchain.events ? `${Math.round((m.blockchain.anchored_events / m.blockchain.events) * 100)}% of events` : undefined} />
        <Tile label="Confirmed receipts" value={String(m.blockchain.confirmed_receipts)} tone="green" />
        <Tile label="Failed receipts" value={String(m.blockchain.failed_receipts)} tone={m.blockchain.failed_receipts ? "red" : "slate"} />
      </Section>

      <Section title="Audit governance & validation">
        <Tile label="Alerts raised" value={String(m.alerts.total)} sub={`${m.alerts.open} open · ${m.alerts.investigating} investigating`} />
        <Tile label="Alerts closed" value={String(m.alerts.resolved + m.alerts.false_positive)}
          sub={`${m.alerts.resolved} resolved · ${m.alerts.false_positive} false positive`} />
        <Tile label="Critical still open" value={String(m.alerts.critical_open)} tone={m.alerts.critical_open ? "red" : "green"} />
        <Tile label="Automated tests" value={t ? `${t.passed}/${t.tests} passed` : "not run"}
          sub={t ? t.report : "run pytest with --junitxml"} tone={t && t.passed === t.tests ? "green" : "amber"} />
      </Section>
    </div>
  );
}