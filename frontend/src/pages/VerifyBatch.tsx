import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { PublicBatch } from "../api";

const card = "rounded-lg border border-slate-200 bg-white p-4";
const VTONE: Record<string, string> = {
  verified: "border-emerald-400 bg-emerald-50 text-emerald-900",
  mismatch: "border-red-400 bg-red-50 text-red-900",
  not_anchored: "border-slate-300 bg-slate-50 text-slate-800",
  unavailable: "border-amber-300 bg-amber-50 text-amber-900",
};
const VTEXT: Record<string, string> = {
  verified: "✔ History verified on-chain",
  mismatch: "✖ History does NOT match the on-chain record",
  not_anchored: "… History not yet anchored on-chain",
  unavailable: "Blockchain verification unavailable",
};

export default function VerifyBatch() {
  const { id = "" } = useParams();
  const [b, setB] = useState<PublicBatch | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<PublicBatch>(`/api/v1/public/batches/${id}`).then(setB).catch((e) => setErr((e as Error).message));
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 px-4 py-3 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="font-semibold">E-Waste Ledger</div>
          <div className="text-xs text-slate-400">Public batch passport · read-only</div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {err && <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">{err}</div>}
        {!b && !err && <p className="text-slate-500">Loading passport {id}…</p>}
        {b && (
          <>
            <div className={`rounded-xl border-2 p-5 ${VTONE[b.verification.status] ?? VTONE.unavailable}`}>
              <h1 className="text-xl font-bold">{b.id}</h1>
              <p className="mt-1 font-medium">{VTEXT[b.verification.status] ?? b.verification.status}</p>
              {b.verification.onchain_event_count !== undefined && (
                <p className="mt-1 text-sm">
                  {b.verification.onchain_event_count} of {b.verification.db_event_count} events anchored · {b.verification.network}
                </p>
              )}
            </div>

            <div className={`${card} grid grid-cols-2 gap-3 text-sm`}>
              <div><div className="text-xs text-slate-500">Category</div>{b.category}</div>
              <div><div className="text-xs text-slate-500">Status</div>{b.status}</div>
              <div><div className="text-xs text-slate-500">Collected mass</div>{b.mass_kg} kg</div>
              <div><div className="text-xs text-slate-500">Current custodian</div>{b.custodian}</div>
              <div className="col-span-2"><div className="text-xs text-slate-500">Origin</div>
                {b.origins.map((o) => `${o.id} at ${o.source}`).join(", ")}</div>
            </div>

            <div className={card}>
              <h2 className="font-medium">Journey</h2>
              <ol className="mt-2 space-y-2 text-sm">
                <li>🏭 Collected at {b.source} · {b.original_reading}</li>
                {b.transfers.map((t) => (
                  <li key={t.id}>
                    🚚 {t.from} → {t.to}: sent {t.dispatch_kg} kg, received {t.receipt_kg ?? "pending"}{t.receipt_kg !== null && " kg"}
                    {t.status === "disputed" && <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800">weight disputed</span>}
                    {t.status === "dispatched" && <span className="ml-1 rounded bg-slate-100 px-1.5 text-xs">in transit</span>}
                  </li>
                ))}
                {b.processing.map((r) => (
                  <li key={r.run_id}>
                    ⚙️ Processed at {r.facility}: {r.input_kg} kg in, {r.recovered_kg} kg recovered ({r.yield_pct}%) · mass balance <b>{r.balance_status}</b>
                  </li>
                ))}
              </ol>
            </div>

            {b.certificates.length > 0 && (
              <div className={card}>
                <h2 className="font-medium">Recovery certificates</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {b.certificates.map((c) => (
                    <li key={c.id}>
                      📜 <Link className="text-blue-700 underline" to={`/verify/certificate/${c.id}`}>{c.id}</Link>
                      {" "}· {c.mass_kg} kg {c.material} · {c.status === "retired" ? "🔁 used" : "✔ unused"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}