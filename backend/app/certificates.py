"""Verifiable Recovery Certificates (single-use, anchored on-chain) + public verification."""
import hashlib
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column
from web3 import Web3

from .blockchain import NETWORKS, BlockchainReceipt, chain, chain_heads, send_tx, verify_batch
from .db import Base, get_db
from .lineage import BatchLineage
from .models import Batch, Transfer, utcnow
from .recovery import MaterialOutput, ProcessingRun, RecoveryClaim, append_event

router = APIRouter(tags=["certificates"])
SEPOLIA = 11155111


class RecoveryCertificate(Base):
    __tablename__ = "recovery_certificates"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    claim_id: Mapped[str] = mapped_column(ForeignKey("recovery_claims.claim_id"), unique=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    payload: Mapped[str] = mapped_column(Text)                     # canonical JSON
    cert_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(default="issued")           # issued | retired
    chain_status: Mapped[str] = mapped_column(default="not_submitted")  # not_submitted|confirmed|failed
    issue_tx: Mapped[str | None]
    retire_tx: Mapped[str | None]
    retired_by: Mapped[str | None]
    retire_purpose: Mapped[str | None] = mapped_column(Text)
    retired_at: Mapped[datetime | None]
    issued_at: Mapped[datetime] = mapped_column(default=utcnow)


class EvidenceDoc(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    bytes: int = Field(ge=0)


class IssueIn(BaseModel):
    claim_id: str
    issued_by: str = Field(min_length=2)
    documents: list[EvidenceDoc] = Field(default_factory=list, max_length=5)


class RetireIn(BaseModel):
    retired_by: str = Field(min_length=2)
    purpose: str = Field(min_length=5, max_length=300)


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def origins(db: Session, batch_id: str) -> list[dict]:
    """Walk split/merge lineage upwards to the original collection batches."""
    seen, stack, out = set(), [batch_id], []
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        parents = [e.parent_id for e in db.query(BatchLineage).filter_by(child_id=cur)]
        if not parents:
            b = db.get(Batch, cur)
            out.append({"id": b.id, "source": b.source_facility_id})
        stack.extend(parents)
    return sorted(out, key=lambda x: x["id"])


def cert_out(c: RecoveryCertificate) -> dict:
    p = json.loads(c.payload)
    return {"id": c.id, "claim_id": c.claim_id, "batch_id": c.batch_id,
            "material": p["claim"]["material"], "mass_kg": p["claim"]["mass_kg"],
            "status": c.status, "chain_status": c.chain_status, "cert_hash": c.cert_hash,
            "issue_tx": c.issue_tx, "retire_tx": c.retire_tx, "retired_by": c.retired_by,
            "retire_purpose": c.retire_purpose, "retired_at": c.retired_at, "issued_at": c.issued_at}


# ---------- internal endpoints ----------
@router.get("/api/v1/certificates")
def list_certificates(db: Session = Depends(get_db)):
    return [cert_out(c) for c in
            db.query(RecoveryCertificate).order_by(RecoveryCertificate.issued_at.desc())]


@router.get("/api/v1/certificates/eligible-claims")
def eligible_claims(db: Session = Depends(get_db)):
    done = {c.claim_id for c in db.query(RecoveryCertificate).all()}
    out = []
    for cl in db.query(RecoveryClaim).order_by(RecoveryClaim.created_at.desc()):
        if cl.claim_id in done:
            continue
        o = db.get(MaterialOutput, cl.output_id)
        r = db.get(ProcessingRun, o.run_id)
        out.append({"claim_id": cl.claim_id, "run_id": r.id, "batch_id": r.batch_id,
                    "material": o.material, "mass_kg": cl.mass_g / 1000, "claimant": cl.claimant})
    return out


@router.post("/api/v1/certificates", status_code=201)
def issue_certificate(body: IssueIn, db: Session = Depends(get_db)):
    claim = db.get(RecoveryClaim, body.claim_id)
    if not claim:
        raise HTTPException(404, "Only accepted recovery claims can be certified")
    if db.query(RecoveryCertificate).filter_by(claim_id=claim.claim_id).first():
        raise HTTPException(409, f"Claim {claim.claim_id} already has a certificate")
    out = db.get(MaterialOutput, claim.output_id)
    run = db.get(ProcessingRun, out.run_id)
    batch = db.get(Batch, run.batch_id)
    if run.balance_status == "critical":
        raise HTTPException(409, "Cannot certify material from a run with a critical mass balance")
    heads, broken = chain_heads(db, batch.id)
    if broken is not None:
        raise HTTPException(409, f"Batch audit chain broken at event {broken}; cannot certify")

    cid = f"RC-{utcnow().year}-{db.query(RecoveryCertificate).count() + 1:04d}"
    payload = {
        "certificate_id": cid,
        "standard": "E-Waste Ledger Recovery Certificate v1",
        "claim": {"claim_id": claim.claim_id, "material": out.material, "mass_kg": claim.mass_g / 1000,
                  "claimant": claim.claimant, "evidence_sha256": claim.evidence_hash,
                  "accepted_at": claim.created_at.isoformat(timespec="seconds")},
        "processing": {"run_id": run.id, "facility": run.facility_id, "input_kg": run.input_g / 1000,
                       "recovered_kg": run.recovered_g / 1000, "variance_pct": float(run.variance_pct),
                       "yield_pct": float(run.yield_pct), "balance_status": run.balance_status,
                       "evidence_sha256": run.evidence_hash},
        "batch": {"batch_id": batch.id, "category": batch.category, "source": batch.source_facility_id,
                  "origins": origins(db, batch.id), "audit_chain_head": heads[-1] if heads else None,
                  "events": len(heads)},
        "integrity_checks": ["claim ID unique", "physical mass balance plausible",
                             "evidence not reused", "material available (atomic allocation)"],
        "documents": [d.model_dump() for d in body.documents],
        "issued_by": body.issued_by,
        "issued_at": utcnow().isoformat(timespec="seconds"),
    }
    text = _canonical(payload)
    h = _sha(text)
    cert = RecoveryCertificate(id=cid, claim_id=claim.claim_id, batch_id=batch.id,
                               payload=text, cert_hash=h)
    db.add(cert)
    append_event(db, batch.id, "CERTIFICATE_ISSUED",
                 {"certificate_id": cid, "cert_hash": h, "claim_id": claim.claim_id}, body.issued_by)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Certificate conflict; please retry")

    # anchor on-chain (honest fallback: stays 'not_submitted' if the chain is offline)
    try:
        w3, c, dep = chain()
        rec = BlockchainReceipt(subject_type="certificate", subject_id=cid, anchored_hash="0x" + h,
                                chain_id=dep["chain_id"], contract=dep["address"])
        db.add(rec)
        db.commit()
        r = send_tx(w3, c.functions.issueCertificate(cid, bytes.fromhex(h)), rec, db)
        ok = r.status == 1 and len(c.events.CertificateIssued().process_receipt(r)) == 1
        rec.status = cert.chain_status = "confirmed" if ok else "failed"
        cert.issue_tx = rec.tx_hash
        db.commit()
    except HTTPException as e:
        cert.chain_status = "not_submitted" if e.status_code == 503 else "failed"
        db.commit()
    return cert_out(cert)


@router.post("/api/v1/certificates/{cert_id}/retire")
def retire_certificate(cert_id: str, body: RetireIn, db: Session = Depends(get_db)):
    cert = db.get(RecoveryCertificate, cert_id)
    if not cert:
        raise HTTPException(404, "Certificate not found")
    if cert.status == "retired":
        raise HTTPException(409, f"DOUBLE_USE blocked: {cert.id} was already retired by "
                                 f"{cert.retired_by} on {cert.retired_at:%Y-%m-%d %H:%M} "
                                 f"for '{cert.retire_purpose}'")

    if cert.chain_status == "confirmed":            # the chain is the source of truth for use
        try:
            w3, c, dep = chain()
        except HTTPException:
            raise HTTPException(503, "Certificate is anchored on-chain, so its retirement must be "
                                     "recorded on-chain too, but the chain is unreachable")
        _, _, retired_at = c.functions.getCertificate(cert.id).call()
        if retired_at:
            cert.status = "retired"
            db.commit()
            raise HTTPException(409, f"DOUBLE_USE blocked: {cert.id} is already retired on-chain")
        rec = BlockchainReceipt(subject_type="certificate_retirement", subject_id=cert.id,
                                anchored_hash="0x" + cert.cert_hash,
                                chain_id=dep["chain_id"], contract=dep["address"])
        db.add(rec)
        db.commit()
        r = send_tx(w3, c.functions.retireCertificate(cert.id, bytes.fromhex(cert.cert_hash),
                                                      body.retired_by), rec, db)
        ok = r.status == 1 and len(c.events.CertificateRetired().process_receipt(r)) == 1
        rec.status = "confirmed" if ok else "failed"
        if not ok:
            db.commit()
            raise HTTPException(502, "Retirement transaction failed on-chain")
        cert.retire_tx = rec.tx_hash

    cert.status = "retired"
    cert.retired_by = body.retired_by
    cert.retire_purpose = body.purpose.strip()
    cert.retired_at = utcnow()
    append_event(db, cert.batch_id, "CERTIFICATE_RETIRED",
                 {"certificate_id": cert.id, "retired_by": body.retired_by,
                  "purpose": body.purpose.strip()}, body.retired_by)
    db.commit()
    return cert_out(cert)


# ---------- public, read-only verification ----------
@router.get("/api/v1/public/certificates/{cert_id}")
def public_certificate(cert_id: str, db: Session = Depends(get_db)):
    cert = db.get(RecoveryCertificate, cert_id)
    if not cert:
        raise HTTPException(404, "No certificate with this ID exists")
    recomputed = _sha(cert.payload)
    db_ok = recomputed == cert.cert_hash
    onchain, chain_err = None, None
    try:
        w3, c, dep = chain()
        h, issued, retired = c.functions.getCertificate(cert.id).call()
        onchain = {"cert_hash": Web3.to_hex(h), "issued_at": issued, "retired_at": retired,
                   "network": NETWORKS.get(dep["chain_id"], str(dep["chain_id"])),
                   "contract": dep["address"], "public": dep["chain_id"] == SEPOLIA}
    except HTTPException as e:
        chain_err = e.detail

    if not db_ok or (onchain and onchain["issued_at"] and onchain["cert_hash"] != "0x" + cert.cert_hash):
        verdict = "tampered"
    elif cert.status == "retired" or (onchain and onchain["retired_at"]):
        verdict = "retired"
    elif onchain and onchain["issued_at"]:
        verdict = "valid"
    else:
        verdict = "unverified"

    return {"certificate_id": cert.id, "verdict": verdict, "status": cert.status,
            "payload": json.loads(cert.payload), "cert_hash": cert.cert_hash,
            "recomputed_hash": recomputed, "db_integrity": db_ok,
            "onchain": onchain, "chain_error": chain_err,
            "retired_by": cert.retired_by, "retire_purpose": cert.retire_purpose,
            "retired_at": cert.retired_at, "issue_tx": cert.issue_tx, "retire_tx": cert.retire_tx}


@router.get("/api/v1/public/batches/{batch_id}")
def public_batch(batch_id: str, db: Session = Depends(get_db)):
    b = db.get(Batch, batch_id)
    if not b:
        raise HTTPException(404, "No batch with this ID exists")
    try:
        v = verify_batch(batch_id, db)
        verification = {k: v[k] for k in ("status", "network", "onchain_event_count",
                                          "db_event_count", "unanchored_events")}
    except HTTPException as e:
        verification = {"status": "unavailable", "detail": e.detail}
    certs = db.query(RecoveryCertificate).filter_by(batch_id=b.id).all()
    return {
        "id": b.id, "category": b.category, "status": b.status, "source": b.source_facility_id,
        "custodian": b.custodian_id, "mass_kg": b.net_mass_g / 1000,
        "original_reading": b.original_reading, "weighed_at": b.weighed_at,
        "origins": origins(db, b.id),
        "transfers": [{"id": t.id, "from": t.sender_id, "to": t.receiver_id,
                       "dispatch_kg": t.dispatch_mass_g / 1000,
                       "receipt_kg": None if t.receipt_mass_g is None else t.receipt_mass_g / 1000,
                       "status": t.status} for t in db.query(Transfer).filter_by(batch_id=b.id)],
        "processing": [{"run_id": r.id, "facility": r.facility_id, "input_kg": r.input_g / 1000,
                        "recovered_kg": r.recovered_g / 1000, "yield_pct": float(r.yield_pct),
                        "balance_status": r.balance_status}
                       for r in db.query(ProcessingRun).filter_by(batch_id=b.id)],
        "certificates": [{"id": c.id, "status": c.status,
                          "material": json.loads(c.payload)["claim"]["material"],
                          "mass_kg": json.loads(c.payload)["claim"]["mass_kg"]} for c in certs],
        "verification": verification,
    }