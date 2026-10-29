import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, ClipboardCheck, Factory, PackageOpen, ShoppingBag, Truck } from "lucide-react";
import { api, currentActor, setActor } from "../api";
import type { Actor, BatchSummary, Role, Workspace as WS } from "../api";

const ICON: Record<Role, typeof Truck> = {
  generator: Building2, collector: PackageOpen, transporter: Truck,
  recycler: Factory, auditor: ClipboardCheck, buyer: ShoppingBag,
};
const card = "rounded-lg border border-slate-200 bg-white p-4";
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50";

function nextBatchId(batches: BatchSummary[]) {
  const nums = batches.map((b) => /^EW-2026-(\d{4})$/.exec(b.id)).filter(Boolean).map((m) => Number(m![1]));
  return `EW-2026-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`;
}

function FlowMap({ actors, current }: { actors: Actor[]; current: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actors.map((a, i) => {
        const Icon = ICON[a.role];
        const active = a.id === current;
        return (
          <div key={a.id} className="flex items-center gap-2">
            <button onClick={() => setActor(a.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                active ? "border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200"
                  : "border-slate-300 bg-white hover:bg-slate-50"}`}>
              <Icon size={15} /> {a.step}. {a.role_label}
            </button>
            {i < actors.length - 1 && <ArrowRight size={14} className="text-slate-400" />}
          </div>
        );
      })}
    </div>
  );
}

export default function Workspace() {
  const actorId = currentActor();
  const [actors, setActors] = useState<Actor[]>([]);
  const [w, setW] = useState<WS | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [handover, setHandover] = useState({ category: "IT", kg: "", to: "" });

  const load = async () => {
    setActors(await api<Actor[]>("/api/v1/actors"));
    if (actorId) setW(await api<WS>(`/api/v1/workspace/${actorId}`));
  };

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
    }
  };

  const dispatch = (batchId: string, kg: number) => act(async () => {
    const to = targets[batchId] || w!.next_parties.find((p) => p.eligible)?.id;
    if (!to) throw new Error("No eligible next party");
    await api("/api/v1/transfers", {
      method: "POST",
      body: JSON.stringify({
        id: `TR-${Date.now().toString().slice(-6)}`, batch_id: batchId, receiver_id: to,
        mass: { value: Number(weights[batchId] ?? kg), unit: "kg" }, actor: w!.actor.name,
      }),
    });
    return `${batchId} dispatched to ${to}. They must now confirm the weight they receive.`;
  });

  const receive = (transferId: string, kg: number) => act(async () => {
    await api(`/api/v1/transfers/${transferId}/receive`, {
      method: "POST",
      body: JSON.stringify({
        receiver_id: w!.actor.facility_id, mass: { value: Number(weights[transferId] ?? kg), unit: "kg" },
        actor: w!.actor.name,
      }),
    });
    return `Receipt confirmed for ${transferId}. Weights compared automatically.`;
  });

  const handOver = () => act(async () => {
    const batches = await api<BatchSummary[]>("/api/v1/batches");
    const id = nextBatchId(batches);
    const to = handover.to || w!.next_parties[0]?.id;
    await api("/api/v1/batches", {
      method: "POST",
      body: JSON.stringify({
        id, source_facility_id: w!.actor.facility_id, category: handover.category,
        mass: { value: Number(handover.kg), unit: "kg" }, operator: w!.actor.name,
        weighed_at: new Date().toISOString().slice(0, 19),
      }),
    });
    await api("/api/v1/transfers", {
      method: "POST",
      body: JSON.stringify({
        id: `TR-${Date.now().toString().slice(-6)}`, batch_id: id, receiver_id: to,
        mass: { value: Number(handover.kg), unit: "kg" }, actor: w!.actor.name,
      }),
    });
    setHandover({ ...handover, kg: "" });
    return `${id} (${handover.kg} kg ${handover.category}) handed over to ${to}.`;
  });

  const retire = (certId: string) => act(async () => {
    await api(`/api/v1/certificates/${certId}/retire`, {
      method: "POST",
      body: JSON.stringify({ retired_by: w!.actor.name, purpose: "Recycled-content declaration for purchase order PO-5521" }),
    });
    return `${certId} used. It can never be used again by anyone.`;
  });

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">My workspace</h1>
        <p className="text-sm text-slate-500">Each participant sees and does only their own part of the journey</p>
      </div>

      <div className={card}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">The e-waste journey</div>
        <FlowMap actors={actors} current={actorId} />
        <p className="mt-3 text-xs text-slate-500">
          Click a participant to act as them. Demo identity switcher; in production each organization signs in with its own account or wallet.
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {msg.text}
        </div>
      )}

      {!actorId && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actors.map((a) => {
            const Icon = ICON[a.role];
            return (
              <button key={a.id} onClick={() => setActor(a.id)} className={`${card} text-left hover:border-emerald-400`}>
                <div className="flex items-center gap-2 font-medium"><Icon size={18} /> {a.step}. {a.role_label}</div>
                <div className="mt-1 text-sm text-slate-700">{a.name}</div>
                <div className="mt-1 text-xs text-slate-500">{a.does}</div>
              </button>
            );
          })}
        </div>
      )}

      {w && (
        <>
          <div className={`${card} flex items-center gap-3`}>
            {(() => { const Icon = ICON[w.actor.role]; return <Icon size={28} className="text-emerald-700" />; })()}
            <div>
              <div className="font-semibold">{w.actor.name}</div>
              <div className="text-sm text-slate-600">{w.actor.role_label} · {w.actor.does}{w.actor.facility_id && ` · site ${w.actor.facility_id}`}</div>
            </div>
          </div>

          {/* E-waste company: hand over */}
          {w.actor.role === "generator" && (
            <div className={card}>
              <h2 className="font-medium">Hand over e-waste</h2>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <select className={input} value={handover.category} onChange={(e) => setHandover({ ...handover, category: e.target.value })}>
                  <option>IT</option><option>TELECOM</option><option>CONSUMER</option>
                </select>
                <input className={`${input} w-36`} type="number" placeholder="declared kg" value={handover.kg}
                  onChange={(e) => setHandover({ ...handover, kg: e.target.value })} />
                <select className={input} value={handover.to} onChange={(e) => setHandover({ ...handover, to: e.target.value })}>
                  {w.next_parties.map((p) => <option key={p.id} value={p.id}>to {p.name}</option>)}
                </select>
                <button className={btn} disabled={busy || !handover.kg} onClick={handOver}>Hand over</button>
              </div>
              {w.my_batches.length > 0 && (
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Batch</th><th>Declared</th><th>Now with</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {w.my_batches.map((b) => (
                      <tr key={b.batch_id}>
                        <td className="py-1.5"><Link className="text-blue-700 hover:underline" to={`/batches/${b.batch_id}`}>{b.batch_id}</Link></td>
                        <td>{b.mass_kg} kg {b.category}</td><td>{b.custodian}</td><td>{b.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Collector / transporter / recycler: incoming */}
          {["collector", "transporter", "recycler"].includes(w.actor.role) && (
            <div className={card}>
              <h2 className="font-medium">Incoming: confirm what you actually received</h2>
              {w.incoming.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing on its way to you.</p> : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {w.incoming.map((t) => (
                    <li key={t.transfer_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <b>{t.batch_id}</b> from {t.from} · sent <b>{t.dispatch_kg} kg</b>
                      <input className={`${input} ml-auto w-32`} type="number" placeholder="weighed kg"
                        value={weights[t.transfer_id] ?? String(t.dispatch_kg)}
                        onChange={(e) => setWeights({ ...weights, [t.transfer_id]: e.target.value })} />
                      <button className={btn} disabled={busy} onClick={() => receive(t.transfer_id, t.dispatch_kg)}>Confirm receipt</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Collector / transporter: in custody, pass on */}
          {["collector", "transporter"].includes(w.actor.role) && (
            <div className={card}>
              <h2 className="font-medium">In my custody: pass it on</h2>
              {w.holding.length === 0 ? <p className="mt-2 text-sm text-slate-500">You're not holding any e-waste.</p> : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {w.holding.map((b) => (
                    <li key={b.batch_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <Link className="font-medium text-blue-700 hover:underline" to={`/batches/${b.batch_id}`}>{b.batch_id}</Link>
                      · {b.mass_kg} kg {b.category}
                      {b.disputed && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">weight disputed</span>}
                      <select className={`${input} ml-auto`} value={targets[b.batch_id] ?? ""}
                        onChange={(e) => setTargets({ ...targets, [b.batch_id]: e.target.value })}>
                        <option value="">next: choose…</option>
                        {w.next_parties.map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.eligible}>{p.name}{p.note ? ` (${p.note})` : ""}</option>
                        ))}
                      </select>
                      <input className={`${input} w-28`} type="number" value={weights[b.batch_id] ?? String(b.mass_kg)}
                        onChange={(e) => setWeights({ ...weights, [b.batch_id]: e.target.value })} />
                      <button className={btn} disabled={busy} onClick={() => dispatch(b.batch_id, b.mass_kg)}>Dispatch</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Recycler */}
          {w.actor.role === "recycler" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className={card}>
                <h2 className="font-medium">Ready to process</h2>
                {w.holding.length === 0 ? <p className="mt-2 text-sm text-slate-500">No delivered e-waste waiting.</p> : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {w.holding.map((b) => <li key={b.batch_id}>{b.batch_id} · {b.mass_kg} kg {b.category}{b.disputed && " · ⚠ disputed"}</li>)}
                  </ul>
                )}
                <Link to="/recovery" className={`${btn} mt-3 inline-block`}>Process &amp; claim →</Link>
              </div>
              <div className={card}>
                <h2 className="font-medium">Claims ready to certify</h2>
                {w.to_certify.length === 0 ? <p className="mt-2 text-sm text-slate-500">No accepted claims awaiting a certificate.</p> : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {w.to_certify.map((c) => <li key={c.claim_id}>{c.claim_id} · {c.mass_kg} kg {c.material}</li>)}
                  </ul>
                )}
                <Link to="/certificates" className={`${btn} mt-3 inline-block`}>Issue certificates →</Link>
              </div>
            </div>
          )}

          {/* Sent history */}
          {w.sent.length > 0 && (
            <div className={card}>
              <h2 className="font-medium">What I sent</h2>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Batch</th><th>To</th><th>Sent</th><th>They received</th><th>Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {w.sent.map((t) => (
                    <tr key={t.transfer_id}>
                      <td className="py-1.5">{t.batch_id}</td><td>{t.to}</td><td>{t.dispatch_kg} kg</td>
                      <td>{t.receipt_kg ?? "awaiting"}{t.receipt_kg !== null && " kg"}</td>
                      <td><span className={`rounded px-2 py-0.5 text-xs ${t.status === "disputed" ? "bg-amber-100 text-amber-800" : t.status === "received" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100"}`}>{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Auditor */}
          {w.actor.role === "auditor" && w.audit && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className={card}>
                <div className="text-sm text-slate-500">Open alerts to review</div>
                <div className="text-3xl font-semibold">{w.audit.open_alerts}</div>
                <div className="text-xs text-red-700">{w.audit.critical_open} critical</div>
                <Link to="/audit" className={`${btn} mt-3 inline-block`}>Review alerts →</Link>
              </div>
              <div className={card}>
                <div className="text-sm text-slate-500">Independent stock check</div>
                <p className="mt-1 text-sm">Weigh stock yourself and compare it with system records and claims.</p>
                <Link to="/inventory" className={`${btn} mt-3 inline-block`}>Count inventory →</Link>
              </div>
            </div>
          )}

          {/* Buyer */}
          {w.actor.role === "buyer" && (
            <div className={card}>
              <h2 className="font-medium">Recovery certificates on offer</h2>
              {w.certificates.length === 0 ? <p className="mt-2 text-sm text-slate-500">No certificates issued yet.</p> : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {w.certificates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <b>{c.id}</b> · {c.mass_kg} kg {c.material}
                      <span className={`rounded px-2 py-0.5 text-xs ${c.status === "retired" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                        {c.status === "retired" ? `used by ${c.retired_by}` : "available"}
                      </span>
                      <Link to={`/verify/certificate/${c.id}`} className="ml-auto text-xs text-blue-700 hover:underline">Verify</Link>
                      <button className={btn} disabled={busy} onClick={() => retire(c.id)}>
                        {c.status === "retired" ? "Try to use again" : "Use certificate"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}