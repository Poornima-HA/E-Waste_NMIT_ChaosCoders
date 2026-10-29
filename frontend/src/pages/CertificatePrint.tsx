import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { CertVerify, Facility } from "../api";
import QrCode from "../QrCode";

const STAMP = {
  valid: { text: "VALID", sub: "not yet used", color: "#047857" },
  retired: { text: "USED", sub: "retired · single use", color: "#b45309" },
  tampered: { text: "TAMPERED", sub: "do not accept", color: "#b91c1c" },
  unverified: { text: "UNVERIFIED", sub: "no on-chain proof", color: "#475569" },
} as const;

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="h-10 w-10" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0f172a" />
      <path d="M32 11 L50 21.5 V42.5 L32 53 L14 42.5 V21.5 Z" fill="none" stroke="#34d399" strokeWidth="4" strokeLinejoin="round" />
      <path d="M23.5 32.5 l6 6 l11.5 -13" fill="none" stroke="#34d399" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="w-[38%] py-0.5 pr-2 align-top text-slate-500">{k}</td>
      <td className={`py-0.5 align-top ${mono ? "break-all font-mono text-[9px]" : ""}`}>{v}</td>
    </tr>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-2.5">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-800">{title}</div>
      {children}
    </div>
  );
}

export default function CertificatePrint() {
  const { id = "" } = useParams();
  const [v, setV] = useState<CertVerify | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<CertVerify>(`/api/v1/public/certificates/${id}`).then(setV).catch((e) => setErr((e as Error).message));
    api<Facility[]>("/api/v1/facilities")
      .then((fs) => setNames(Object.fromEntries(fs.map((f) => [f.id, f.name]))))
      .catch(() => undefined);
    const old = document.title;
    document.title = `Recovery-Certificate-${id}`;   // becomes the PDF file name
    return () => { document.title = old; };
  }, [id]);

  if (err) return <div className="p-8 text-red-700">{err}</div>;
  if (!v) return <div className="p-8 text-slate-500">Preparing certificate {id}…</div>;

  const p = v.payload;
  const s = STAMP[v.verdict];
  const fac = (fid: string) => (names[fid] ? `${names[fid].replace(" (demo)", "")} (${fid})` : fid);
  const url = `${window.location.origin}/verify/certificate/${v.certificate_id}`;
  const origins = p.batch.origins.map((o) => `${o.id} from ${fac(o.source)}`).join(", ");

  return (
    <div className="min-h-screen overflow-x-auto bg-slate-200 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex w-[210mm] items-center justify-between">
        <a href={`/verify/certificate/${v.certificate_id}`} className="text-sm text-slate-700 hover:underline">← Back to live verification</a>
        <button onClick={() => window.print()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">
          ⬇ Download / print PDF
        </button>
      </div>

      <div className="print-sheet mx-auto h-[297mm] w-[210mm] overflow-hidden bg-white p-[8mm] text-[11px] text-slate-900 shadow-xl">
        <div className="relative flex h-full flex-col rounded-lg border-[3px] border-double border-emerald-800 px-[8mm] py-[7mm]">

          {/* stamp */}
          <div className="absolute right-[9mm] top-[27mm] rotate-[-12deg] rounded-lg border-4 px-3 py-0.5 text-center"
            style={{ borderColor: s.color, color: s.color }}>
            <div className="text-xl font-extrabold tracking-widest">{s.text}</div>
            <div className="text-[9px] font-semibold uppercase">{s.sub}</div>
          </div>

          {/* header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-3">
              <Logo />
              <div>
                <div className="text-base font-bold">E-Waste Ledger</div>
                <div className="text-[10px] text-slate-500">Traceable e-waste recovery &amp; audit</div>
              </div>
            </div>
            <div className="text-right text-[10px]">
              <div className="text-slate-500">Certificate no.</div>
              <div className="text-sm font-bold">{v.certificate_id}</div>
              <div className="text-slate-500">Issued {p.issued_at.replace("T", " ")} UTC</div>
            </div>
          </div>

          {/* title + statement */}
          <div className="mt-4 text-center">
            <div className="text-[9px] font-semibold uppercase tracking-[0.25em] text-emerald-800">{p.standard}</div>
            <h1 className="mt-1 font-serif text-[22px] font-bold leading-tight">Certificate of Verified Material Recovery</h1>
          </div>
          <p className="mx-auto mt-3 max-w-[165mm] text-center text-[11.5px] leading-relaxed">
            This certifies that <b>{p.claim.mass_kg} kg of recovered {p.claim.material}</b> was produced by{" "}
            <b>{fac(p.processing.facility)}</b> in processing run <b>{p.processing.run_id}</b>, from e-waste batch{" "}
            <b>{p.batch.batch_id}</b> ({p.batch.category}), originally collected as <b>{origins}</b>. The recovery claim{" "}
            <b>{p.claim.claim_id}</b> passed every check of the E-Waste Ledger Recovery Integrity Gate, and this
            certificate's fingerprint is recorded on a blockchain.
          </p>

          {/* details */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Box title="Traceability">
              <table className="w-full"><tbody>
                <Row k="Collected" v={origins} />
                <Row k="Batch" v={`${p.batch.batch_id} · ${p.batch.events} hash-chained events`} />
                <Row k="Processed at" v={fac(p.processing.facility)} />
                <Row k="Claim" v={`${p.claim.claim_id} by ${p.claim.claimant}`} />
                <Row k="Claim accepted" v={p.claim.accepted_at.replace("T", " ")} />
              </tbody></table>
            </Box>
            <Box title="Physical mass balance">
              <table className="w-full"><tbody>
                <Row k="Processing input" v={`${p.processing.input_kg} kg`} />
                <Row k="Total recovered" v={`${p.processing.recovered_kg} kg`} />
                <Row k="Recovery yield" v={`${p.processing.yield_pct}%`} />
                <Row k="Unexplained" v={`${p.processing.variance_pct}% of input`} />
                <Row k="Balance status" v={p.processing.balance_status.toUpperCase()} />
              </tbody></table>
            </Box>
            <Box title="Integrity checks passed">
              <ul className="space-y-0.5">
                {p.integrity_checks.map((c) => <li key={c}>✔ {c.charAt(0).toUpperCase() + c.slice(1)}</li>)}
              </ul>
            </Box>
            <Box title="Usage status">
              {v.verdict === "retired" ? (
                <p>Used by <b>{v.retired_by}</b> on {v.retired_at?.replace("T", " ").slice(0, 16)} for "{v.retire_purpose}". <b>It cannot be used again.</b></p>
              ) : v.verdict === "tampered" ? (
                <p className="font-semibold text-red-700">This record does not match its proof. Do not accept this certificate.</p>
              ) : (
                <p>Not yet used. This certificate can be used (retired) <b>exactly once</b>; every use is recorded on-chain.</p>
              )}
            </Box>
          </div>

          <div className="mt-2.5">
            <Box title="Cryptographic evidence">
              <table className="w-full"><tbody>
                <Row k="Certificate SHA-256" v={v.cert_hash} mono />
                <Row k="Batch audit-chain head" v={p.batch.audit_chain_head ?? "—"} mono />
                <Row k="Claim evidence SHA-256" v={p.claim.evidence_sha256} mono />
                <Row k="Processing evidence SHA-256" v={p.processing.evidence_sha256} mono />
                {p.documents.map((d) => <Row key={d.sha256} k={`Document: ${d.name}`} v={d.sha256} mono />)}
                <Row k="Blockchain" v={v.onchain ? `${v.onchain.network} · contract ${v.onchain.contract}` : (v.chain_error ?? "not available")} />
                <Row k="Issuance transaction" v={v.issue_tx ?? "—"} mono />
                {v.retire_tx && <Row k="Retirement transaction" v={v.retire_tx} mono />}
              </tbody></table>
            </Box>
          </div>

          {/* QR + issuer, pinned to the bottom of the page */}
          <div className="mt-auto flex items-end justify-between gap-6 pt-3">
            <div className="flex items-center gap-3">
              <QrCode url={url} size={96} />
              <div className="max-w-[62mm] text-[10px]">
                <div className="font-semibold">Scan to verify live</div>
                <div className="text-slate-600">Checks authenticity, tampering and whether this certificate has already been used.</div>
              </div>
            </div>
            <div className="text-right text-[10px]">
              <div className="mb-1 ml-auto h-px w-44 bg-slate-400" />
              <div className="font-semibold">Issued by {p.issued_by}</div>
              <div className="text-slate-500">Digitally anchored · no handwritten signature required</div>
            </div>
          </div>

          <p className="mt-3 border-t border-slate-200 pt-2 text-[8px] leading-snug text-slate-500">
            Demonstration certificate generated from clearly labelled demo data
            {v.onchain && !v.onchain.public ? " on a local demonstration blockchain (not a public network)" : ""}. A blockchain record
            proves this certificate has not been altered since issuance and records its single use; it does not by itself prove the
            accuracy of underlying measurements, which depends on calibrated equipment and procedures. Mass-balance tolerances are
            demonstration values, not regulatory standards. Facilities shown are not government-verified.
          </p>
        </div>
      </div>
    </div>
  );
}