import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Link2, ShieldCheck } from "lucide-react";
import { api } from "../api";
import type { BatchSummary, ChainStatus, Receipt, VerifyResult } from "../api";

type ReceiptRow = Receipt & { id: number; created_at: string };

const card = "rounded-lg border border-slate-200 bg-white";
const short = (h?: string | null, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
const TONE: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  mismatch: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-amber-100 text-amber-800",
  not_anchored: "bg-slate-100 text-slate-600",
};

export default function Ledger() {
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [checks, setChecks] = useState<VerifyResult[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setChain(await api<ChainStatus>("/api/v1/blockchain/status"));
      setChainErr(null);
    } catch (e) {
      setChain(null);
      setChainErr((e as Error).message);
    }
    setReceipts(await api<ReceiptRow[]>("/api/v1/blockchain/receipts"));
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const verifyAll = async () => {
    setBusy(true);
    try {
      const batches = await api<BatchSummary[]>("/api/v1/batches");
      const res = await Promise.all(
        batches.map((b) => api<VerifyResult>(`/api/v1/blockchain/batches/${b.id}/verify`)));
      setChecks(res);
    } catch (e) {
      setChainErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tally = (s: string) => checks.filter((c) => c.status === s).length;

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Blockchain audit trail</h1>
        <p className="text-sm text-slate-500">
          Hashes on-chain, operational data off-chain · independent verification of every anchor
        </p>
      </div>

      {/* network */}
      <div className={`${card} p-4`}>
        <h2 className="flex items-center gap-2 font-medium"><Link2 size={16} /> Network &amp; contract</h2>
        {chainErr ? (
          <p className="mt-2 text-sm text-red-700">Chain unavailable: {chainErr}</p>
        ) : chain ? (
          <>
            {!chain.public && (
              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                ⚠ Local demo chain. Transactions are real contract calls, but not on a public network.
              </p>
            )}
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><div className="text-xs text-slate-500">Network</div>{chain.network}</div>
              <div><div className="text-xs text-slate-500">Chain ID</div>{chain.chain_id}</div>
              <div><div className="text-xs text-slate-500">Contract</div>
                <span className="font-mono text-xs">{short(chain.contract, 14)}</span></div>
              <div><div className="text-xs text-slate-500">Latest block</div>{chain.latest_block}</div>
            </div>
            <p className="mt-2 font-mono text-xs text-slate-500">Deploy tx {chain.deploy_tx}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Connecting…</p>
        )}
      </div>

      {/* what goes where */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${card} p-4`}>
          <h3 className="font-medium">On-chain (public, tamper-evident)</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Batch audit-chain head hash + event count</li>
            <li>Approved dispatch plan hash (QpiAI Opt) + scenario hash</li>
            <li>Attestor address and block timestamp</li>
          </ul>
        </div>
        <div className={`${card} p-4`}>
          <h3 className="font-medium">Off-chain (controlled database)</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Weights, materials, costs, licences, addresses</li>
            <li>Evidence documents (only their SHA-256 goes on-chain)</li>
            <li>Solver inputs, outputs and audit findings</li>
          </ul>
        </div>
      </div>

      {/* verify everything */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Independent verification</h2>
          <button onClick={verifyAll} disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? "Verifying…" : "Verify every batch on-chain"}
          </button>
        </div>
        {checks.length > 0 && (
          <>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-3 py-1 ${TONE.verified}`}>verified · {tally("verified")}</span>
              <span className={`rounded-full px-3 py-1 ${TONE.mismatch}`}>mismatch · {tally("mismatch")}</span>
              <span className={`rounded-full px-3 py-1 ${TONE.not_anchored}`}>not anchored · {tally("not_anchored")}</span>
            </div>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-2">Batch</th><th>Status</th><th>Anchored events</th><th>Unanchored</th><th>On-chain head</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {checks.map((c) => (
                  <tr key={c.batch_id}>
                    <td className="py-2"><Link to={`/batches/${c.batch_id}`} className="text-blue-700 hover:underline">{c.batch_id}</Link></td>
                    <td><span className={`rounded px-2 py-0.5 text-xs ${TONE[c.status]}`}>{c.status.replace("_", " ")}</span></td>
                    <td>{c.onchain_event_count} / {c.db_event_count}</td>
                    <td>{c.unanchored_events || "—"}</td>
                    <td className="font-mono text-xs">{short(c.onchain_head, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* receipts */}
      <div className={card}>
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium">On-chain receipts ({receipts.length})</h2>
        {receipts.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No anchors yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">#</th><th>Subject</th><th>Status</th><th>Anchored hash</th><th>Tx</th><th>Block</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.id}</td>
                  <td>{r.subject}{r.event_count ? ` (${r.event_count} events)` : ""}</td>
                  <td><span className={`rounded px-2 py-0.5 text-xs ${TONE[r.status] ?? ""}`}>{r.status}</span></td>
                  <td className="font-mono text-xs">{short(r.anchored_hash, 12)}</td>
                  <td className="font-mono text-xs">
                    {r.explorer ? <a href={r.explorer} target="_blank" rel="noreferrer" className="underline">{short(r.tx_hash, 12)}</a>
                      : short(r.tx_hash, 12)}
                  </td>
                  <td>{r.block ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}