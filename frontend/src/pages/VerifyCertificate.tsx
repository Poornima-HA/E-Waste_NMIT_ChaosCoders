import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { CertVerify } from "../api";
import { sha256File } from "../sha256";

const BANNER = {
  valid: { cls: "border-emerald-400 bg-emerald-50 text-emerald-900", icon: "✔", title: "VALID: not yet used" },
  retired: { cls: "border-amber-400 bg-amber-50 text-amber-900", icon: "🔁", title: "ALREADY USED: certificate retired" },
  tampered: { cls: "border-red-400 bg-red-50 text-red-900", icon: "✖", title: "TAMPERED: record does not match its proof" },
  unverified: { cls: "border-slate-300 bg-slate-50 text-slate-800", icon: "…", title: "UNVERIFIED: no on-chain proof available" },
} as const;

const short = (h?: string | null, n = 12) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : "—");
const card = "rounded-lg border border-slate-200 bg-white p-4";

export default function VerifyCertificate() {
  const { id = "" } = useParams();
  const [v, setV] = useState<CertVerify | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fileCheck, setFileCheck] = useState<{ name: string; hash: string; match: string | null } | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);

  useEffect(() => {
    api<CertVerify>(`/api/v1/public/certificates/${id}`).then(setV).catch((e) => setErr((e as Error).message));
  }, [id]);

  const checkFile = async (f: File | undefined) => {
    if (!f || !v) return;
    setFileErr(null);
    try {
      const hash = await sha256File(f);
      const m = v.payload.documents.find((d) => d.sha256 === hash);
      setFileCheck({ name: f.name, hash, match: m ? m.name : null });
    } catch (e) {
      setFileErr((e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 px-4 py-3 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="font-semibold">E-Waste Ledger</div>
          <div className="text-xs text-slate-400">Public certificate verification · read-only</div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {err && <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">{err}</div>}
        {!v && !err && <p className="text-slate-500">Verifying certificate {id}…</p>}
        {v && (() => {
          const b = BANNER[v.verdict];
          const p = v.payload;
          return (
            <>
              <div className={`rounded-xl border-2 p-5 ${b.cls}`}>
                <div className="text-3xl">{b.icon}</div>
                <h1 className="mt-1 text-xl font-bold">{b.title}</h1>
                <p className="mt-1 text-sm">Certificate <b>{v.certificate_id}</b> · {p.claim.mass_kg} kg recovered <b>{p.claim.material}</b></p>
                <a href={`/verify/certificate/${v.certificate_id}/print`}
                  className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800">
                  📄 View / download certificate (PDF)
                </a>
                {v.verdict === "retired" && (
                  <p className="mt-2 text-sm">
                    Used by <b>{v.retired_by}</b> for "{v.retire_purpose}" on {v.retired_at?.replace("T", " ").slice(0, 16)}.
                    It cannot be used again.
                  </p>
                )}
              </div>

              <div className={card}>
                <h2 className="font-medium">Integrity proof</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  <li>{v.db_integrity ? "✔" : "✖"} Certificate content matches its SHA-256 fingerprint</li>
                  <li>
                    {v.onchain?.issued_at
                      ? (v.onchain.cert_hash === `0x${v.cert_hash}` ? "✔ Fingerprint matches the blockchain record" : "✖ Fingerprint differs from the blockchain record")
                      : "… Not found on-chain"}
                  </li>
                  <li>{v.onchain?.retired_at ? "🔁 Marked as used on-chain" : "✔ Not marked as used on-chain"}</li>
                </ul>
                <p className="mt-2 break-all font-mono text-xs text-slate-500">sha256 {v.cert_hash}</p>
                {v.onchain && (
                  <p className="mt-1 text-xs text-slate-500">
                    {v.onchain.network} · contract {short(v.onchain.contract, 10)}
                    {!v.onchain.public && " · local demo chain, not a public network"}
                  </p>
                )}
                {v.chain_error && <p className="mt-1 text-xs text-amber-700">Blockchain unavailable: {v.chain_error}</p>}
              </div>

              <div className={card}>
                <h2 className="font-medium">Traceability</h2>
                <ol className="mt-2 space-y-2 text-sm">
                  <li>🏭 Collected: {p.batch.origins.map((o) => `${o.id} at ${o.source}`).join(", ")}</li>
                  <li>📦 Batch <Link className="text-blue-700 underline" to={`/verify/batch/${p.batch.batch_id}`}>{p.batch.batch_id}</Link> · {p.batch.category} · {p.batch.events} hash-chained events</li>
                  <li>⚙️ Processed in {p.processing.run_id} at {p.processing.facility}: {p.processing.input_kg} kg in, {p.processing.recovered_kg} kg recovered ({p.processing.yield_pct}% yield) · mass balance <b>{p.processing.balance_status}</b> ({p.processing.variance_pct}% unexplained)</li>
                  <li>✅ Claim {p.claim.claim_id} by {p.claim.claimant} passed: {p.integrity_checks.join(" · ")}</li>
                  <li>📜 Issued by {p.issued_by} on {p.issued_at.replace("T", " ")}</li>
                </ol>
              </div>

              <div className={card}>
                <h2 className="font-medium">Check an evidence document</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Select the original document (e.g. the weighbridge slip). It is hashed <b>on your device</b> and never uploaded.
                </p>
                <input className="mt-2 text-sm" type="file" onChange={(e) => checkFile(e.target.files?.[0])} />
                {p.documents.length === 0 && <p className="mt-2 text-xs text-slate-500">No documents were attached at issuance.</p>}
                {fileErr && <p className="mt-2 text-sm text-amber-700">{fileErr}</p>}
                {fileCheck && (
                  <p className={`mt-2 rounded-md p-2 text-sm ${fileCheck.match ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
                    {fileCheck.match
                      ? `✔ "${fileCheck.name}" is identical to the recorded document "${fileCheck.match}".`
                      : `✖ "${fileCheck.name}" does not match any document recorded for this certificate (sha256 ${fileCheck.hash.slice(0, 16)}…).`}
                  </p>
                )}
              </div>
            </>
          );
        })()}
      </main>
    </div>
  );
}