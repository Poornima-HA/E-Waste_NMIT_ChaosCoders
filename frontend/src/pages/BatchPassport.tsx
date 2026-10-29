import CostPanel from "../CostPanel";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Link2, ShieldAlert, ShieldCheck, Truck } from "lucide-react";
import { api } from "../api";
import type { BatchDetail, Facility, VerifyResult } from "../api";

const short = (h: string | null | undefined, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
const card = "rounded-lg border border-slate-200 bg-white";
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50";

export default function BatchPassport() {
  const { id = "" } = useParams();
  const [b, setB] = useState<BatchDetail | null>(null);
  const [v, setV] = useState<VerifyResult | null>(null);
  const [vErr, setVErr] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiver, setReceiver] = useState("F1");
  const [dispatchKg, setDispatchKg] = useState("");
  const [receiptKg, setReceiptKg] = useState("");

  const load = useCallback(async () => {
    try {
      const [batch, facs] = await Promise.all([
        api<BatchDetail>(`/api/v1/batches/${id}`),
        api<Facility[]>("/api/v1/facilities"),
      ]);
      setB(batch);
      setFacilities(facs);
      setDispatchKg((prev) => prev || String(batch.net_mass_kg));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    try {
      setV(await api<VerifyResult>(`/api/v1/blockchain/batches/${id}/verify`));
      setVErr(null);
    } catch (e) {
      setV(null);
      setVErr((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: `${label}: done` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: `${label} blocked: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  if (!b) return <div className="p-8 text-slate-500">{msg ? msg.text : "Loading batch passport…"}</div>;

  const pending = b.transfers.find((t) => t.status === "dispatched");
  const canDispatch = b.status === "collected" || b.status === "received";
  const processors = facilities.filter((f) => f.kind === "processor");
  const vTone =
    v?.status === "verified" ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : v?.status === "mismatch" ? "border-red-300 bg-red-50 text-red-900"
    : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className="space-y-6 p-8">
      <Link to="/batches" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> All batches
      </Link>

      {/* header */}
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{b.id}</h1>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{b.category}</span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{b.status}</span>
        </div>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div><div className="text-xs text-slate-500">Source</div>{b.source}</div>
          <div><div className="text-xs text-slate-500">Current custodian</div><b>{b.custodian}</b></div>
          <div><div className="text-xs text-slate-500">Collected mass</div>{b.net_mass_kg.toLocaleString()} kg</div>
          <div><div className="text-xs text-slate-500">Original reading</div>{b.original_reading} · {b.operator}</div>
          <div><div className="text-xs text-slate-500">Weighed at</div>{b.weighed_at.replace("T", " ")}</div>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {msg.text}
        </div>
      )}

      {/* actions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <h2 className="flex items-center gap-2 font-medium"><Truck size={16} /> Custody action</h2>
          {canDispatch && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <select className={input} value={receiver} onChange={(e) => setReceiver(e.target.value)}>
                {processors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} {f.licence_valid ? "" : "(licence expired)"}
                  </option>
                ))}
              </select>
              <input className={`${input} w-28`} type="number" value={dispatchKg}
                onChange={(e) => setDispatchKg(e.target.value)} />
              <span className="text-sm text-slate-500">kg</span>
              <button disabled={busy} className={btn}
                onClick={() => act("Dispatch", () => api("/api/v1/transfers", {
                  method: "POST",
                  body: JSON.stringify({
                    id: `TR-${Date.now().toString().slice(-6)}`, batch_id: b.id, receiver_id: receiver,
                    mass: { value: Number(dispatchKg), unit: "kg" }, actor: b.operator,
                  }),
                }))}>
                Dispatch
              </button>
            </div>
          )}
          {pending && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <span className="text-sm">Receive <b>{pending.id}</b> at <b>{pending.to}</b> (sent {pending.dispatch_kg} kg):</span>
              <input className={`${input} w-28`} type="number" placeholder="weighed kg" value={receiptKg}
                onChange={(e) => setReceiptKg(e.target.value)} />
              <button disabled={busy || !receiptKg} className={btn}
                onClick={() => act("Receipt", () => api(`/api/v1/transfers/${pending.id}/receive`, {
                  method: "POST",
                  body: JSON.stringify({
                    receiver_id: pending.to, mass: { value: Number(receiptKg), unit: "kg" },
                    actor: `${pending.to}-gate`,
                  }),
                }))}>
                Record receipt
              </button>
            </div>
          )}
          {!canDispatch && !pending && <p className="mt-3 text-sm text-slate-500">No custody action available.</p>}
        </div>

        {/* on-chain verification */}
        <div className={`rounded-lg border p-4 ${vTone}`}>
          <h2 className="flex items-center gap-2 font-medium">
            {v?.status === "mismatch" ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
            On-chain verification
          </h2>
          {vErr ? (
            <p className="mt-2 text-sm">Blockchain unavailable: {vErr}</p>
          ) : v ? (
            <div className="mt-2 space-y-1 text-sm">
              <p className="text-base font-semibold">
                {v.status === "verified" && `✔ Verified: anchored up to event ${v.onchain_event_count} of ${v.db_event_count}`}
                {v.status === "mismatch" && "✖ MISMATCH: database history differs from the on-chain anchor"}
                {v.status === "not_anchored" && "Not yet anchored on-chain"}
              </p>
              {v.unanchored_events > 0 && v.status !== "mismatch" && (
                <p>{v.unanchored_events} newer event(s) not yet anchored.</p>
              )}
              {v.db_chain_broken_at_event !== null && <p>Off-chain hash chain broken at event #{v.db_chain_broken_at_event}.</p>}
              <p className="text-xs">Network: {v.network}</p>
              <p className="font-mono text-xs">On-chain head: {short(v.onchain_head, 14)}</p>
              {v.last_receipt?.tx_hash && (
                <p className="font-mono text-xs">
                  Tx: {v.last_receipt.explorer
                    ? <a className="underline" href={v.last_receipt.explorer} target="_blank" rel="noreferrer">{short(v.last_receipt.tx_hash, 14)}</a>
                    : short(v.last_receipt.tx_hash, 14)}
                  {" "}· receipt re-checked on chain: {v.tx_receipt_verified ? "yes" : "no"}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm">Checking…</p>
          )}
          <div className="mt-3 flex gap-2">
            <button disabled={busy} className={btn} onClick={() => act("Verify", async () => undefined)}>
              Re-verify
            </button>
            <button disabled={busy} className={btn}
              onClick={() => act("Anchor", () => api(`/api/v1/blockchain/batches/${b.id}/anchor`, { method: "POST" }))}>
              <span className="inline-flex items-center gap-1"><Link2 size={14} /> Anchor latest events</span>
            </button>
          </div>
        </div>
      </div>
      <CostPanel batchId={b.id} />
      {/* custody timeline */}
      <div className={card}>
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Chain of custody</h2>
        {b.transfers.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">At source {b.source}. No transfers yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {b.transfers.map((t) => {
              const gap = t.receipt_kg === null ? null : t.dispatch_kg - t.receipt_kg;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <span className="font-mono text-xs text-slate-500">{t.id}</span>
                  <b>{t.from} → {t.to}</b>
                  <span>dispatched {t.dispatch_kg} kg</span>
                  <span>received {t.receipt_kg ?? "pending"}{t.receipt_kg !== null && " kg"}</span>
                  {gap !== null && gap !== 0 && <span className="text-red-700">gap {gap.toFixed(3)} kg</span>}
                  <span className={`ml-auto rounded px-2 py-0.5 text-xs ${
                    t.status === "disputed" ? "bg-red-100 text-red-800"
                    : t.status === "dispatched" ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-800"}`}>
                    {t.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* hash-chained event log */}
      <div className={card}>
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Hash-chained audit events</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">#</th><th className="px-4 py-2">Event</th><th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Prev hash</th><th className="px-4 py-2">Event hash</th><th className="px-4 py-2">Chain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {b.events.map((e, i) => (
              <tr key={e.id}>
                <td className="px-4 py-2">{i + 1}</td>
                <td className="px-4 py-2 font-medium">{e.type}</td>
                <td className="px-4 py-2">{e.actor}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{short(e.prev_hash)}</td>
                <td className="px-4 py-2 font-mono text-xs">{short(e.hash)}</td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${e.chain_status === "anchored" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                    {e.chain_status === "anchored" ? "anchored" : "off-chain only"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {b.alerts.length > 0 && (
        <div className={card}>
          <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Alerts on this batch</h2>
          <ul className="divide-y divide-slate-100">
            {b.alerts.map((a) => (
              <li key={a.id} className="p-4 text-sm">
                <span className="mr-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{a.severity}</span>
                <span className="font-mono text-xs text-slate-500">{a.rule}</span>
                <p className="mt-1">{a.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}