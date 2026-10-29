import { useEffect, useState } from "react";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { api } from "../api";
import type { CertSummary, EligibleClaim } from "../api";
import QrCode from "../QrCode";
import { sha256File } from "../sha256";

const card = "rounded-lg border border-slate-200 bg-white";
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50";
const STATUS: Record<string, string> = {
  issued: "bg-emerald-100 text-emerald-800",
  retired: "bg-amber-100 text-amber-800",
};
const CHAIN: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  not_submitted: "bg-slate-100 text-slate-600",
};
type Doc = { name: string; sha256: string; bytes: number };

export default function Certificates() {
  const [certs, setCerts] = useState<CertSummary[]>([]);
  const [eligible, setEligible] = useState<EligibleClaim[]>([]);
  const [claimId, setClaimId] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("Recycled-content declaration for buyer order PO-5521");
  const [retiredBy, setRetiredBy] = useState("buyer-greenmetals");
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  const load = async () => {
    const [c, e] = await Promise.all([
      api<CertSummary[]>("/api/v1/certificates"),
      api<EligibleClaim[]>("/api/v1/certificates/eligible-claims"),
    ]);
    setCerts(c);
    setEligible(e);
    setClaimId((prev) => (prev && e.some((x) => x.claim_id === prev) ? prev : e[0]?.claim_id ?? ""));
  };

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      const out: Doc[] = [];
      for (const f of Array.from(files).slice(0, 5)) {
        out.push({ name: f.name, sha256: await sha256File(f), bytes: f.size });
      }
      setDocs(out);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const issue = () => run(async () => {
    const c = await api<CertSummary>("/api/v1/certificates", {
      method: "POST",
      body: JSON.stringify({ claim_id: claimId, issued_by: "recycler-alpha", documents: docs }),
    });
    setDocs([]);
    return `${c.id} issued for ${c.mass_kg} kg ${c.material} · on-chain: ${c.chain_status}`;
  });

  const retire = (id: string) => run(async () => {
    await api(`/api/v1/certificates/${id}/retire`, {
      method: "POST", body: JSON.stringify({ retired_by: retiredBy, purpose }),
    });
    setRetiring(null);
    return `${id} retired by ${retiredBy}. It can never be used again.`;
  });

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Recovery certificates</h1>
        <p className="text-sm text-slate-500">
          Single-use, on-chain-anchored proof that verified recovered material exists, and hasn't been used before
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {msg.text}
        </div>
      )}
      {local && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          QR codes point to localhost, which phones can't open. For phone scanning, run{" "}
          <code>npm run dev -- --host</code> and open the app via its Network URL.
        </p>
      )}

      {/* issue */}
      <div className={`${card} p-4`}>
        <h2 className="flex items-center gap-2 font-medium"><BadgeCheck size={16} /> Issue a certificate</h2>
        {eligible.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No accepted claim is waiting for a certificate.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-500">Accepted claim
              <select className={`${input} block`} value={claimId} onChange={(e) => setClaimId(e.target.value)}>
                {eligible.map((c) => (
                  <option key={c.claim_id} value={c.claim_id}>
                    {c.claim_id} · {c.mass_kg} kg {c.material} · {c.batch_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">Evidence documents (hashed locally, optional)
              <input className="block text-sm" type="file" multiple onChange={(e) => onFiles(e.target.files)} />
            </label>
            <button className={btn} disabled={busy || !claimId} onClick={issue}>Issue &amp; anchor</button>
            {docs.length > 0 && (
              <ul className="w-full text-xs text-slate-500">
                {docs.map((d) => <li key={d.sha256}>📄 {d.name} · sha256 {d.sha256.slice(0, 16)}…</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* list */}
      {certs.length === 0 && <p className="text-sm text-slate-500">No certificates issued yet.</p>}
      {certs.map((c) => {
        const url = `${window.location.origin}/verify/certificate/${c.id}`;
        return (
          <div key={c.id} className={`${card} flex flex-wrap gap-6 p-4`}>
            <QrCode url={url} size={130} />
            <div className="min-w-[260px] flex-1 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{c.id}</h3>
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS[c.status]}`}>{c.status}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${CHAIN[c.chain_status] ?? "bg-slate-100"}`}>
                  on-chain: {c.chain_status.replace("_", " ")}
                </span>
              </div>
              <p><b>{c.mass_kg} kg {c.material}</b> · claim {c.claim_id} · batch {c.batch_id}</p>
              <p className="font-mono text-xs text-slate-500">certificate hash {c.cert_hash}</p>
              {c.status === "retired" && (
                <p className="text-amber-800">
                  Retired by <b>{c.retired_by}</b> · {c.retire_purpose} · {c.retired_at?.replace("T", " ").slice(0, 16)}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100">
                  <ExternalLink size={12} /> Public verify page
                </a>
                <a href={`/verify/certificate/${c.id}/print`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100">
                  📄 Certificate PDF
                </a>
                {c.status === "issued" && retiring !== c.id && (
                  <button className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
                    onClick={() => setRetiring(c.id)}>
                    Retire (use certificate)
                  </button>
                )}
                {c.status === "retired" && (
                  <button className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                    disabled={busy} onClick={() => retire(c.id)}>
                    🛑 Try to use it again
                  </button>
                )}
              </div>
              {retiring === c.id && (
                <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3">
                  <input className={`${input} w-44`} value={retiredBy} onChange={(e) => setRetiredBy(e.target.value)} />
                  <input className={`${input} min-w-[260px] flex-1`} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                  <button className={btn} disabled={busy || purpose.length < 5} onClick={() => retire(c.id)}>Confirm retire</button>
                  <button className="text-xs text-slate-500" onClick={() => setRetiring(null)}>cancel</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}