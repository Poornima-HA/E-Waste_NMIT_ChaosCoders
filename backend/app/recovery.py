"""Processing runs, physical mass balance and the Recovery Integrity Gate."""
import hashlib
import json
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, get_db
from .models import AuditAlert, AuditEvent, Batch, Transfer, utcnow

UNIT_TO_G = {"g": Decimal(1), "kg": Decimal(1000), "t": Decimal(1_000_000)}
BALANCE_PASS_PCT = Decimal("1.0")        # demo thresholds, not regulatory standards
BALANCE_CRITICAL_PCT = Decimal("3.0")
INPUT_VS_RECEIPT_TOL_PCT = Decimal("0.5")
GENESIS = "0" * 64

router = APIRouter(tags=["recovery"])


# ---------- tables ----------
class ProcessingRun(Base):
    __tablename__ = "processing_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    input_g: Mapped[int]
    recovered_g: Mapped[int]
    residual_g: Mapped[int]
    loss_g: Mapped[int]
    wip_change_g: Mapped[int]
    variance_g: Mapped[int]
    variance_pct: Mapped[str]
    yield_pct: Mapped[str]
    balance_status: Mapped[str]              # pass | warning | critical
    evidence_hash: Mapped[str] = mapped_column(String(64))
    operator: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class MaterialOutput(Base):
    __tablename__ = "material_outputs"
    __table_args__ = (UniqueConstraint("run_id", "material"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("processing_runs.id"))
    material: Mapped[str]
    mass_g: Mapped[int]
    allocated_g: Mapped[int] = mapped_column(Integer, default=0)


class RecoveryClaim(Base):                    # accepted claims only
    __tablename__ = "recovery_claims"
    claim_id: Mapped[str] = mapped_column(String(40), primary_key=True)   # DB-level uniqueness
    output_id: Mapped[int] = mapped_column(ForeignKey("material_outputs.id"))
    claimant: Mapped[str]
    mass_g: Mapped[int]
    evidence_hash: Mapped[str] = mapped_column(String(64), unique=True)  # DB-level evidence uniqueness
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ClaimAttempt(Base):                     # append-only log of EVERY attempt
    __tablename__ = "claim_attempts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str]
    run_id: Mapped[str]
    material: Mapped[str]
    mass_g: Mapped[int]
    claimant: Mapped[str]
    evidence_hash: Mapped[str]
    decision: Mapped[str]                     # accepted | rejected
    rule: Mapped[str | None]
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ---------- schemas ----------
class Mass(BaseModel):
    value: Decimal = Field(ge=0)
    unit: Literal["g", "kg", "t"] = "kg"


class SignedMass(BaseModel):                  # WIP change can be negative
    value: Decimal = Decimal(0)
    unit: Literal["g", "kg", "t"] = "kg"


class OutputIn(BaseModel):
    material: str = Field(min_length=2, max_length=40)
    mass: Mass


class ProcessingIn(BaseModel):
    id: str = Field(pattern=r"^PR-\d{4}$")
    batch_id: str
    facility_id: str
    input: Mass
    outputs: list[OutputIn] = Field(min_length=1)
    residual: Mass
    process_loss: Mass
    wip_change: SignedMass = SignedMass()
    operator: str
    evidence_ref: str = Field(min_length=3)


class ClaimIn(BaseModel):
    claim_id: str = Field(pattern=r"^CL-[A-Z0-9-]{3,30}$")
    run_id: str
    material: str
    mass: Mass
    claimant: str
    evidence_ref: str = Field(min_length=3)


# ---------- helpers ----------
def grams(m) -> int:
    return int((m.value * UNIT_TO_G[m.unit]).to_integral_value())


def sha(text: str) -> str:
    return hashlib.sha256(text.strip().encode()).hexdigest()


def append_event(db: Session, batch_id: str, event_type: str, payload: dict, actor: str):
    """Same canonical format as main.record_event, so verify-chain stays valid."""
    last = (db.query(AuditEvent).filter_by(batch_id=batch_id)
            .order_by(AuditEvent.id.desc()).first())
    prev = last.event_hash if last else GENESIS
    canonical = json.dumps(
        {"batch_id": batch_id, "type": event_type, "actor": actor,
         "payload": payload, "prev": prev},
        sort_keys=True, separators=(",", ":"), default=str)
    db.add(AuditEvent(batch_id=batch_id, event_type=event_type, actor=actor,
                      payload=canonical, prev_hash=prev,
                      event_hash=hashlib.sha256(canonical.encode()).hexdigest()))
    db.flush()


def run_out(db: Session, r: ProcessingRun) -> dict:
    outs = db.query(MaterialOutput).filter_by(run_id=r.id).all()
    return {
        "id": r.id, "batch_id": r.batch_id, "facility_id": r.facility_id,
        "input_kg": r.input_g / 1000, "recovered_kg": r.recovered_g / 1000,
        "residual_kg": r.residual_g / 1000, "loss_kg": r.loss_g / 1000,
        "wip_change_kg": r.wip_change_g / 1000, "variance_kg": r.variance_g / 1000,
        "variance_pct": float(r.variance_pct), "yield_pct": float(r.yield_pct),
        "balance_status": r.balance_status, "evidence_hash": r.evidence_hash,
        "operator": r.operator, "created_at": r.created_at,
        "thresholds": {"pass_pct": float(BALANCE_PASS_PCT), "critical_pct": float(BALANCE_CRITICAL_PCT),
                       "note": "demonstration thresholds, not validated operating standards"},
        "outputs": [{"id": o.id, "material": o.material, "mass_kg": o.mass_g / 1000,
                     "allocated_kg": o.allocated_g / 1000,
                     "available_kg": (o.mass_g - o.allocated_g) / 1000} for o in outs],
    }


def reject(db: Session, att: dict, rule: str, reason: str, batch_id: str):
    db.add(ClaimAttempt(**att, decision="rejected", rule=rule, reason=reason))
    db.add(AuditAlert(batch_id=batch_id, transfer_id=None, rule=rule, severity="critical",
                      message=f"Claim {att['claim_id']} BLOCKED: {reason}",
                      measured=json.dumps(att, default=str)))
    db.commit()
    return JSONResponse(status_code=409, content={
        "decision": "rejected", "rule": rule, "detail": f"{rule}: {reason}"})


# ---------- processing runs ----------
@router.post("/api/v1/processing-runs", status_code=201)
def create_run(body: ProcessingIn, db: Session = Depends(get_db)):
    if db.get(ProcessingRun, body.id):
        raise HTTPException(409, "Processing run ID already exists")
    b = db.get(Batch, body.batch_id)
    if not b:
        raise HTTPException(404, "Batch not found")
    if b.custodian_id != body.facility_id or b.status != "received":
        raise HTTPException(409, f"Batch must be received at {body.facility_id} before processing "
                                 f"(custodian {b.custodian_id}, status {b.status})")
    inp = grams(body.input)
    if inp <= 0:
        raise HTTPException(422, "Input mass must be positive")
    mats = [o.material.strip().lower() for o in body.outputs]
    if len(set(mats)) != len(mats):
        raise HTTPException(422, "Each material may appear only once per run")

    rec = sum(grams(o.mass) for o in body.outputs)
    res, loss = grams(body.residual), grams(body.process_loss)
    wip = int((body.wip_change.value * UNIT_TO_G[body.wip_change.unit]).to_integral_value())
    accounted = rec + res + loss + wip
    var = inp - accounted
    pct = Decimal(var) * 100 / Decimal(inp)
    yld = Decimal(rec) * 100 / Decimal(inp)

    alerts = []
    if pct < -BALANCE_PASS_PCT:
        status = "critical"
        alerts.append(("OUTPUTS_EXCEED_INPUT", "critical",
                       f"Physically impossible: outputs account for {accounted/1000} kg but input was "
                       f"{inp/1000} kg ({-pct:.2f}% more out than in)."))
    elif abs(pct) <= BALANCE_PASS_PCT:
        status = "pass"
    else:
        status = "warning" if pct <= BALANCE_CRITICAL_PCT else "critical"
        alerts.append(("UNEXPLAINED_MASS_VARIANCE", status,
                       f"{var/1000} kg ({pct:.2f}%) of input is unaccounted for "
                       f"(tolerance {BALANCE_PASS_PCT}%). Investigate."))

    t = (db.query(Transfer).filter_by(batch_id=b.id, receiver_id=body.facility_id)
         .filter(Transfer.receipt_mass_g.isnot(None))
         .order_by(Transfer.received_at.desc()).first())
    if t and Decimal(inp - t.receipt_mass_g) * 100 / Decimal(t.receipt_mass_g) > INPUT_VS_RECEIPT_TOL_PCT:
        alerts.append(("INPUT_EXCEEDS_RECEIPT", "critical",
                       f"Processor input {inp/1000} kg exceeds the {t.receipt_mass_g/1000} kg received "
                       f"via {t.id}. Material of unknown origin."))

    run = ProcessingRun(id=body.id, batch_id=b.id, facility_id=body.facility_id, input_g=inp,
                        recovered_g=rec, residual_g=res, loss_g=loss, wip_change_g=wip,
                        variance_g=var, variance_pct=str(round(pct, 3)), yield_pct=str(round(yld, 2)),
                        balance_status=status, evidence_hash=sha(body.evidence_ref),
                        operator=body.operator)
    db.add(run)
    db.flush()
    for o in body.outputs:
        db.add(MaterialOutput(run_id=run.id, material=o.material.strip().lower(), mass_g=grams(o.mass)))
    for rule, sev, msg in alerts:
        db.add(AuditAlert(batch_id=b.id, transfer_id=None, rule=rule, severity=sev, message=msg,
                          measured=json.dumps({"run_id": run.id, "input_g": inp, "accounted_g": accounted,
                                               "variance_g": var})))
    b.status = "processed"
    append_event(db, b.id, "PROCESSED",
                 {"run_id": run.id, "facility": body.facility_id, "input_g": inp,
                  "outputs": {m: grams(o.mass) for m, o in zip(mats, body.outputs)},
                  "residual_g": res, "loss_g": loss, "wip_change_g": wip,
                  "variance_g": var, "balance_status": status,
                  "evidence_hash": run.evidence_hash}, body.operator)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate record rejected by database constraint")
    return run_out(db, run)


@router.get("/api/v1/processing-runs")
def list_runs(db: Session = Depends(get_db)):
    return [run_out(db, r) for r in db.query(ProcessingRun).order_by(ProcessingRun.created_at.desc())]


@router.get("/api/v1/processing-runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    r = db.get(ProcessingRun, run_id)
    if not r:
        raise HTTPException(404, "Processing run not found")
    return run_out(db, r)


# ---------- Recovery Integrity Gate ----------
@router.post("/api/v1/claims")
def submit_claim(body: ClaimIn, db: Session = Depends(get_db)):
    run = db.get(ProcessingRun, body.run_id)
    if not run:
        raise HTTPException(404, "Processing run not found")
    material = body.material.strip().lower()
    mg = grams(body.mass)
    if mg <= 0:
        raise HTTPException(422, "Claim mass must be positive")
    ev = sha(body.evidence_ref)
    att = dict(claim_id=body.claim_id, run_id=run.id, material=material, mass_g=mg,
               claimant=body.claimant, evidence_hash=ev)
    checks = []

    # 1. claim uniqueness
    if db.get(RecoveryClaim, body.claim_id):
        return reject(db, att, "DUPLICATE_CLAIM_ID",
                      f"claim ID {body.claim_id} was already accepted", run.batch_id)
    checks.append({"check": "Claim ID unique", "pass": True})

    out = db.query(MaterialOutput).filter_by(run_id=run.id, material=material).first()
    if not out:
        return reject(db, att, "NO_SUCH_OUTPUT",
                      f"run {run.id} recorded no '{material}' output", run.batch_id)

    # 2. physical plausibility
    if run.balance_status == "critical":
        return reject(db, att, "IMPLAUSIBLE_MASS_BALANCE",
                      f"run {run.id} has a critical mass balance ({run.variance_pct}% variance); "
                      "claims from it require investigation", run.batch_id)
    checks.append({"check": "Physical mass balance", "pass": True,
                   "detail": f"{run.balance_status}, variance {run.variance_pct}%"})

    # 3. evidence integrity
    if db.query(RecoveryClaim).filter_by(evidence_hash=ev).first():
        return reject(db, att, "EVIDENCE_REUSED",
                      "this evidence document is already attached to another accepted claim",
                      run.batch_id)
    checks.append({"check": "Evidence not reused", "pass": True, "detail": f"sha256 {ev[:12]}…"})

    # 4. atomic availability: one conditional UPDATE, safe under concurrent requests
    result = db.execute(
        update(MaterialOutput)
        .where(MaterialOutput.id == out.id, MaterialOutput.allocated_g + mg <= MaterialOutput.mass_g)
        .values(allocated_g=MaterialOutput.allocated_g + mg)
        .execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        db.refresh(out)
        return reject(db, att, "OVER_CLAIM",
                      f"requested {mg/1000} kg {material} but only "
                      f"{(out.mass_g - out.allocated_g)/1000} kg of {out.mass_g/1000} kg remains unallocated",
                      run.batch_id)

    db.add(RecoveryClaim(claim_id=body.claim_id, output_id=out.id, claimant=body.claimant,
                         mass_g=mg, evidence_hash=ev))
    db.add(ClaimAttempt(**att, decision="accepted", rule=None, reason="all integrity checks passed"))
    append_event(db, run.batch_id, "CLAIM_ACCEPTED",
                 {"claim_id": body.claim_id, "run_id": run.id, "material": material,
                  "mass_g": mg, "evidence_hash": ev}, body.claimant)
    try:
        db.commit()
    except IntegrityError:                     # concurrent duplicate lost the race
        db.rollback()
        return reject(db, att, "DUPLICATE_CLAIM_ID",
                      "rejected by database uniqueness constraint", run.batch_id)
    db.refresh(out)
    checks.append({"check": "Material available (atomic allocation)", "pass": True,
                   "detail": f"{out.allocated_g/1000} of {out.mass_g/1000} kg now allocated"})
    return JSONResponse(status_code=201, content={
        "decision": "accepted", "claim_id": body.claim_id, "checks": checks})


@router.get("/api/v1/claims")
def list_claims(db: Session = Depends(get_db)):
    return {
        "accepted": [{"claim_id": c.claim_id, "output_id": c.output_id, "claimant": c.claimant,
                      "mass_kg": c.mass_g / 1000, "evidence_hash": c.evidence_hash,
                      "created_at": c.created_at}
                     for c in db.query(RecoveryClaim).order_by(RecoveryClaim.created_at.desc())],
        "attempts": [{"id": a.id, "claim_id": a.claim_id, "run_id": a.run_id, "material": a.material,
                      "mass_kg": a.mass_g / 1000, "claimant": a.claimant, "decision": a.decision,
                      "rule": a.rule, "reason": a.reason, "created_at": a.created_at}
                     for a in db.query(ClaimAttempt).order_by(ClaimAttempt.id.desc())],
    }