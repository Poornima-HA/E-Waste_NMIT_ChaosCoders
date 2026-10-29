import { useEffect, useMemo, useState } from "react";
import { Factory, ShieldCheck, ShieldX } from "lucide-react";
import { api } from "../api";
import type { BatchSummary, ClaimsList, GateResult, ProcRun } from "../api";

const card = "rounded-lg border border-slate-200 bg-white";
const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50";
const ghost = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-100";
const TONE: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

type OutRow = { material: string; kg: string };

export default function Recovery() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [runs, setRuns] = useState<ProcRun[]>([]);
  const [claims, setClaims] = useState<ClaimsList>({ accepted: [], attempts: [] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // processing form (pre-filled with the problem-statement example; all editable)
  const [batchId, setBatchId] = useState("");
  const [inputKg, setInputKg] = useState("500");
  const [outs, setOuts] = useState<OutRow[]>([
    { material: "copper", kg: "80" },
    { material: "aluminium", kg: "40" },
    { material: "plastics", kg: "120" },
  ]);
  const [residual, setResidual] = useState("245");
  const [loss, setLoss] = useState("10");
  const [wip, setWip] = useState("0");
  const [evRef, setEvRef] = useState("Weighbridge slip WB-F1-0042");

  // claim form
  const [runId, setRunId] = useState("");
  const [material, setMaterial] = useState("copper");
  const [claimKg, setClaimKg] = useState("80");
  const [claimId, setClaimId] = useState("CL-COPPER-001");
  const [claimEv, setClaimEv] = useState("Buyer invoice INV-7781");
  const [gate, setGate] = useState<{ ok: boolean; result?: GateResult; text?: string } | null>(null);

  const load = async () => {
    const [b, r, c] = await Promise.all([
      api<BatchSummary[]>("/api/v1/batches"),
      api<ProcRun[]>("/api/v1/processing-runs"),
      api<ClaimsList>("/api/v1/claims"),
    ]);
    setBatches(b);
    setRuns(r);
    setClaims(c);
    setBatchId((prev) => prev || b.find((x) => x.status === "received")?.id || "");
    setRunId((prev) => prev || r[0]?.id || "");
  };

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const ready = batches.filter((b) => b.status === "received");
  const selBatch = batches.find((b) => b.id === batchId);
  const selRun = runs.find((r) => r.id === runId);

  const preview = useMemo(() => {
    const inp = Number(inputKg) || 0;
    const rec = outs.reduce((s, o) => s + (Number(o.kg) || 0), 0);
    const acc = rec + (Number(residual) || 0) + (Number(loss) || 0) + (Number(wip) || 0);
    const v = inp - acc;
    return { inp, rec, acc, v, pct: inp ? (v / inp) * 100 : 0 };
  }, [inputKg, outs, residual, loss, wip]);

  const setOut = (i: number, k: keyof OutRow, v: string) =>
    setOuts(outs.map((o, j) => (j === i ? { ...o, [k]: v } : o)));

  const nextRunId = () => {
    const n = runs.map((r) => Number(r.id.slice(3))).filter((x) => !Number.isNaN(x));
    return `PR-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, "0")}`;
  };

  const submitRun = async () => {
    if (!selBatch) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<ProcRun>("/api/v1/processing-runs", {
        method: "POST",
        body: JSON.stringify({
          id: nextRunId(), batch_id: selBatch.id, facility_id: selBatch.custodian,
          input: { value: Number(inputKg), unit: "kg" },
          outputs: outs.filter((o) => o.material && o.kg)
            .map((o) => ({ material: o.material, mass: { value: Number(o.kg), unit: "kg" } })),
          residual: { value: Number(residual), unit: "kg" },
          process_loss: { value: Number(loss), unit: "kg" },
          wip_change: { value: Number(wip), unit: "kg" },
          operator: `${selBatch.custodian}-line`, evidence_ref: evRef,
        }),
      });
      setMsg({
        ok: r.balance_status !== "critical",
        text: `${r.id} recorded · mass balance ${r.balance_status.toUpperCase()} · unexplained ${r.variance_kg} kg (${r.variance_pct}%)`,
      });
      setRunId(r.id);
      setBatchId("");
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const submitClaim = async () => {
    setBusy(true);
    setGate(null);
    try {
      const r = await api<GateResult>("/api/v1/claims", {
        method: "POST",
        body: JSON.stringify({
          claim_id: claimId, run_id: runId, material,
          mass: { value: Number(claimKg), unit: "kg" },
          claimant: "recycler-alpha", evidence_ref: claimEv,
        }),
      });
      setGate({ ok: true, result: r });
    } catch (e) {
      setGate({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const preset = (id: string, mat: string, kg: string, ev: string) => {
    setClaimId(id);
    setMaterial(mat);
    setClaimKg(kg);
    setClaimEv(ev);
    setGate(null);
  };

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Recovery &amp; claims</h1>
        <p className="text-sm text-slate-500">Physical mass balance and the Recovery Integrity Gate</p>
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {msg.text}
        </div>
      )}

      {/* processing run form */}
      <div className={`${card} p-4`}>
        <h2 className="flex items-center gap-2 font-medium"><Factory size={16} /> Record processing run</h2>
        {ready.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No batch is currently <b>received</b> at a processor. Dispatch and receive one first.</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-500">Batch (received)
                <select className={input} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  {ready.map((b) => <option key={b.id} value={b.id}>{b.id} @ {b.custodian} ({b.net_mass_kg} kg)</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500">Input mass (kg)
                <input className={input} type="number" value={inputKg} onChange={(e) => setInputKg(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">Residual waste (kg)
                <input className={input} type="number" value={residual} onChange={(e) => setResidual(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">Documented process loss (kg)
                <input className={input} type="number" value={loss} onChange={(e) => setLoss(e.target.value)} />
              </label>
              {outs.map((o, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">Recovered material
                    <input className={input} value={o.material} onChange={(e) => setOut(i, "material", e.target.value)} />
                  </label>
                  <label className="text-xs text-slate-500">kg
                    <input className={input} type="number" value={o.kg} onChange={(e) => setOut(i, "kg", e.target.value)} />
                  </label>
                </div>
              ))}
              <label className="text-xs text-slate-500">WIP change (kg)
                <input className={input} type="number" value={wip} onChange={(e) => setWip(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500 md:col-span-2">Evidence reference (hashed with SHA-256)
                <input className={input} value={evRef} onChange={(e) => setEvRef(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <p className="text-sm text-slate-600">
                Preview: {preview.inp} kg in = {preview.acc} kg accounted + <b>{preview.v.toFixed(3)} kg unexplained</b> ({preview.pct.toFixed(2)}%)
                <span className="ml-2 text-xs text-slate-400">(backend calculation is authoritative)</span>
              </p>
              <button className={`${btn} ml-auto`} disabled={busy || !selBatch} onClick={submitRun}>
                {busy ? "Recording…" : "Record run & check balance"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* runs */}
      {runs.map((r) => (
        <div key={r.id} className={`${card} p-4`}>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium">{r.id}</h3>
            <span className="text-sm text-slate-500">{r.batch_id} @ {r.facility_id}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[r.balance_status]}`}>
              mass balance {r.balance_status}
            </span>
            <span className="ml-auto text-sm">Recovery yield <b>{r.yield_pct}%</b></span>
          </div>
          <p className="mt-3 rounded-md bg-slate-50 p-3 font-mono text-sm">
            {r.input_kg} kg input = {r.recovered_kg} recovered + {r.residual_kg} residual + {r.loss_kg} loss
            {" + "}{r.wip_change_kg} WIP + <b className={r.balance_status === "pass" ? "" : "text-red-700"}>{r.variance_kg} unexplained ({r.variance_pct}%)</b>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Tolerance: pass ≤ {r.thresholds.pass_pct}%, critical &gt; {r.thresholds.critical_pct}% ({r.thresholds.note}) · evidence sha256 {r.evidence_hash.slice(0, 12)}…
          </p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">Material</th><th>Recovered</th><th>Claimed</th><th>Available</th><th className="w-1/3">Allocation</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.outputs.map((o) => (
                <tr key={o.id}>
                  <td className="py-2 capitalize">{o.material}</td>
                  <td>{o.mass_kg} kg</td>
                  <td>{o.allocated_kg} kg</td>
                  <td className={o.available_kg === 0 ? "font-medium text-red-700" : ""}>{o.available_kg} kg</td>
                  <td>
                    <div className="h-2 rounded bg-slate-100">
                      <div className="h-2 rounded bg-slate-700" style={{ width: `${(o.allocated_kg / o.mass_kg) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* integrity gate */}
      {runs.length > 0 && (
        <div className={`${card} p-4`}>
          <h2 className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Recovery Integrity Gate: submit a material claim</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-xs text-slate-500">Demo presets:</span>
            <button className={ghost} onClick={() => preset("CL-COPPER-001", "copper", "80", "Buyer invoice INV-7781")}>✅ Legitimate copper claim</button>
            <button className={ghost} onClick={() => preset("CL-COPPER-002", "copper", "80", "Buyer invoice INV-7782")}>🛑 Double-claim same copper</button>
            <button className={ghost} onClick={() => preset("CL-COPPER-001", "copper", "10", "Buyer invoice INV-9001")}>🛑 Reuse claim ID</button>
            <button className={ghost} onClick={() => preset("CL-ALU-001", "aluminium", "20", "Buyer invoice INV-7781")}>🛑 Reuse invoice</button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            <label className="text-xs text-slate-500">Processing run
              <select className={input} value={runId} onChange={(e) => setRunId(e.target.value)}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.id} ({r.balance_status})</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Material
              <select className={input} value={material} onChange={(e) => setMaterial(e.target.value)}>
                {selRun?.outputs.map((o) => <option key={o.id} value={o.material}>{o.material} ({o.available_kg} kg free)</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Claim kg
              <input className={input} type="number" value={claimKg} onChange={(e) => setClaimKg(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">Claim ID
              <input className={input} value={claimId} onChange={(e) => setClaimId(e.target.value.toUpperCase())} />
            </label>
            <label className="text-xs text-slate-500">Evidence reference
              <input className={input} value={claimEv} onChange={(e) => setClaimEv(e.target.value)} />
            </label>
            <div className="flex items-end">
              <button className={`${btn} w-full`} disabled={busy || !runId} onClick={submitClaim}>Submit claim</button>
            </div>
          </div>

          {gate && (gate.ok && gate.result ? (
            <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
              <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} /> {gate.result.claim_id} ACCEPTED: all integrity checks passed</p>
              <ul className="mt-2 space-y-1 text-sm">
                {gate.result.checks.map((c) => (
                  <li key={c.check}>✔ {c.check}{c.detail && <span className="text-emerald-700"> · {c.detail}</span>}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
              <p className="flex items-center gap-2 font-semibold"><ShieldX size={18} /> CLAIM BLOCKED: {gate.text?.split(":")[0]}</p>
              <p className="mt-1 text-sm">{gate.text?.split(":").slice(1).join(":").trim()}</p>
              <p className="mt-2 text-xs">The attempt was logged and an audit alert was raised.</p>
            </div>
          ))}
        </div>
      )}

      {/* attempt log */}
      {claims.attempts.length > 0 && (
        <div className={card}>
          <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Claim decision log (append-only)</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">#</th><th>Claim</th><th>Run · material</th><th>kg</th><th>Decision</th><th>Rule / reason</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {claims.attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">{a.id}</td>
                  <td className="font-mono text-xs">{a.claim_id}</td>
                  <td>{a.run_id} · {a.material}</td>
                  <td>{a.mass_kg}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${a.decision === "accepted" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                      {a.decision}
                    </span>
                  </td>
                  <td className="py-2 text-xs">{a.rule && <b>{a.rule}: </b>}{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}