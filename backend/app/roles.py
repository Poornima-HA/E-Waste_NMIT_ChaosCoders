"""Role-based participation:
E-waste company -> Collector -> Transporter -> Recycler -> Auditor -> Buyer.

A request with an X-Actor header is checked against the participant's role and custody.
A request WITHOUT the header is the operator console (demo setup, tests, admin).
Demo identity switcher only; production would use SSO or per-organization wallet signatures.
"""
import json
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import String
from sqlalchemy.orm import Mapped, Session, mapped_column

from .certificates import RecoveryCertificate
from .db import Base, SessionLocal, get_db
from .models import AuditAlert, Batch, Facility, Transfer
from .recovery import MaterialOutput, ProcessingRun, RecoveryClaim

router = APIRouter(tags=["roles"])

ROLES = {
    "generator":   {"label": "E-waste company", "step": 1, "does": "Hands over e-waste with a declared weight"},
    "collector":   {"label": "Collector", "step": 2, "does": "Weighs incoming e-waste and dispatches it to a transporter"},
    "transporter": {"label": "Transporter", "step": 3, "does": "Confirms pickup weight and delivers to a licensed recycler"},
    "recycler":    {"label": "Recycler", "step": 4, "does": "Confirms delivery, processes, claims recovered material, issues certificates"},
    "auditor":     {"label": "Auditor", "step": 5, "does": "Counts stock independently and investigates alerts"},
    "buyer":       {"label": "Material buyer", "step": 6, "does": "Verifies and uses recovery certificates"},
}

SEED = [
    ("ACT-GEN", "Priya · TechCorp Pvt Ltd", "generator", "GEN-1"),
    ("ACT-COL", "Ravi · Collection Centre A", "collector", "CC-A"),
    ("ACT-TRN", "Arjun · GreenMove Logistics", "transporter", "TR-1"),
    ("ACT-REC", "Meena · Recycler Alpha (F1)", "recycler", "F1"),
    ("ACT-AUD", "Kiran · Independent auditor", "auditor", None),
    ("ACT-BUY", "Sana · GreenMetals Pvt Ltd", "buyer", None),
]


class Actor(Base):
    __tablename__ = "actors"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str]
    role: Mapped[str]
    facility_id: Mapped[str | None]


def ensure_actors(db: Session):
    if db.query(Actor).count():
        return
    db.add_all([Actor(id=i, name=n, role=r, facility_id=f) for i, n, r, f in SEED])
    db.commit()


def actor_out(a: Actor) -> dict:
    r = ROLES[a.role]
    return {"id": a.id, "name": a.name, "role": a.role, "role_label": r["label"],
            "step": r["step"], "does": r["does"], "facility_id": a.facility_id}


# ---------- ownership checks (return an error message, or None if allowed) ----------
def _own_source(db, a, m, body):
    if body.get("source_facility_id") != a.facility_id:
        return f"you can only register e-waste at your own site ({a.facility_id})."


def _custodian(db, a, m, body):
    b = db.get(Batch, body.get("batch_id", ""))
    if b and b.custodian_id != a.facility_id:
        return f"{b.id} is currently held by {b.custodian_id}. Only the current custodian can dispatch it."


def _receiver(db, a, m, body):
    t = db.get(Transfer, m.group(1))
    if t and t.receiver_id != a.facility_id:
        return f"transfer {t.id} is addressed to {t.receiver_id}. Only the receiving party can confirm it."


def _custodian_path(db, a, m, body):
    b = db.get(Batch, m.group(1))
    if b and b.custodian_id != a.facility_id:
        return f"{b.id} is held by {b.custodian_id}, not by you."


def _merge(db, a, m, body):
    for pid in body.get("parent_ids", []):
        b = db.get(Batch, pid)
        if b and b.custodian_id != a.facility_id:
            return f"{b.id} is held by {b.custodian_id}, not by you."


def _own_process(db, a, m, body):
    if body.get("facility_id") != a.facility_id:
        return f"you can only record processing at your own facility ({a.facility_id})."


def _own_run(db, a, m, body):
    run = db.get(ProcessingRun, body.get("run_id", ""))
    if run and run.facility_id != a.facility_id:
        return f"run {run.id} belongs to {run.facility_id}; you can only claim your own recovered material."


def _own_claim(db, a, m, body):
    claim = db.get(RecoveryClaim, body.get("claim_id", ""))
    if claim:
        run = db.get(ProcessingRun, db.get(MaterialOutput, claim.output_id).run_id)
        if run.facility_id != a.facility_id:
            return f"claim {claim.claim_id} belongs to {run.facility_id}; you can only certify your own material."


RULES = [
    ("POST", r"^/api/v1/batches$", {"generator", "collector"}, "register e-waste", _own_source),
    ("POST", r"^/api/v1/transfers$", {"generator", "collector", "transporter"}, "dispatch e-waste", _custodian),
    ("POST", r"^/api/v1/transfers/([^/]+)/receive$", {"collector", "transporter", "recycler"}, "confirm receipt", _receiver),
    ("POST", r"^/api/v1/batches/([^/]+)/split$", {"collector", "recycler"}, "split batches", _custodian_path),
    ("POST", r"^/api/v1/batches/merge$", {"collector", "recycler"}, "merge batches", _merge),
    ("POST", r"^/api/v1/processing-runs$", {"recycler"}, "record processing", _own_process),
    ("POST", r"^/api/v1/claims$", {"recycler"}, "claim recovered material", _own_run),
    ("POST", r"^/api/v1/certificates$", {"recycler"}, "issue certificates", _own_claim),
    ("POST", r"^/api/v1/certificates/([^/]+)/anchor$", {"recycler"}, "anchor certificates", None),
    ("POST", r"^/api/v1/certificates/([^/]+)/retire$", {"buyer"}, "use (retire) certificates", None),
    ("POST", r"^/api/v1/costs$", {"collector", "transporter", "recycler"}, "record costs", None),
    ("POST", r"^/api/v1/inventory/counts$", {"auditor"}, "record physical stock counts", None),
    ("POST", r"^/api/v1/audits/alerts/(\d+)/resolve$", {"auditor"}, "review alerts", None),
    ("POST", r"^/api/v1/optimization/solve$", {"collector"}, "run dispatch optimization", None),
    ("POST", r"^/api/v1/optimization/runs/([^/]+)/approve$", {"collector"}, "approve dispatch plans", None),
    ("POST", r"^/api/v1/blockchain/batches/([^/]+)/anchor$",
     {"collector", "transporter", "recycler", "auditor"}, "anchor audit chains", None),
]
COMPILED = [(meth, re.compile(p), roles, label, check) for meth, p, roles, label, check in RULES]


async def role_guard(request: Request, call_next):
    actor_id = request.headers.get("x-actor")
    if not actor_id or request.method in ("GET", "HEAD", "OPTIONS"):
        return await call_next(request)

    match = None
    for meth, rx, roles, label, check in COMPILED:
        mm = rx.match(request.url.path)
        if meth == request.method and mm:
            match = (mm, roles, label, check)
            break

    with SessionLocal() as db:
        ensure_actors(db)
        a = db.get(Actor, actor_id)
        if not a:
            return JSONResponse(status_code=401, content={"detail": f"Unknown participant '{actor_id}'"})
        role_label = ROLES[a.role]["label"]
        if not match:
            return JSONResponse(status_code=403, content={"detail": f"ROLE_NOT_PERMITTED: not available to {role_label}."})
        mm, roles, label, check = match
        if a.role not in roles:
            allowed = " or ".join(ROLES[r]["label"] for r in sorted(roles, key=lambda r: ROLES[r]["step"]))
            return JSONResponse(status_code=403, content={
                "detail": f"ROLE_NOT_PERMITTED: only {allowed} can {label}. You are acting as {role_label} ({a.name})."})
        if check:
            try:
                raw = await request.body()
                body = json.loads(raw) if raw else {}
            except Exception:
                body = {}
            err = check(db, a, mm, body)
            if err:
                return JSONResponse(status_code=403, content={"detail": f"NOT_YOUR_CUSTODY: {err}"})
    return await call_next(request)


# ---------- endpoints ----------
@router.get("/api/v1/actors")
def list_actors(db: Session = Depends(get_db)):
    ensure_actors(db)
    return sorted((actor_out(a) for a in db.query(Actor)), key=lambda x: x["step"])


NEXT_KIND = {"generator": "collection", "collector": "transporter", "transporter": "processor"}


@router.get("/api/v1/workspace/{actor_id}")
def workspace(actor_id: str, db: Session = Depends(get_db)):
    ensure_actors(db)
    a = db.get(Actor, actor_id)
    if not a:
        raise HTTPException(404, "Participant not found")
    fac = a.facility_id
    w = {"actor": actor_out(a), "incoming": [], "holding": [], "sent": [], "next_parties": [],
         "my_batches": [], "to_certify": [], "certificates": [], "audit": None}

    if fac:
        w["incoming"] = [{"transfer_id": t.id, "batch_id": t.batch_id, "from": t.sender_id,
                          "dispatch_kg": t.dispatch_mass_g / 1000, "dispatched_at": t.dispatched_at}
                         for t in db.query(Transfer).filter_by(receiver_id=fac, status="dispatched")]
        for b in db.query(Batch).filter(Batch.custodian_id == fac, Batch.status.in_(["collected", "received"])):
            t = (db.query(Transfer).filter_by(batch_id=b.id, receiver_id=fac)
                 .filter(Transfer.receipt_mass_g.isnot(None)).order_by(Transfer.received_at.desc()).first())
            w["holding"].append({"batch_id": b.id, "category": b.category, "status": b.status,
                                 "mass_kg": (t.receipt_mass_g if t else b.net_mass_g) / 1000,
                                 "disputed": bool(t and t.status == "disputed")})
        w["sent"] = [{"transfer_id": t.id, "batch_id": t.batch_id, "to": t.receiver_id,
                      "dispatch_kg": t.dispatch_mass_g / 1000,
                      "receipt_kg": None if t.receipt_mass_g is None else t.receipt_mass_g / 1000,
                      "status": t.status}
                     for t in db.query(Transfer).filter_by(sender_id=fac)
                     .order_by(Transfer.dispatched_at.desc()).limit(8)]

    kind = NEXT_KIND.get(a.role)
    if kind:
        for f in db.query(Facility).filter_by(kind=kind):
            ok = kind != "processor" or (f.licence_valid_until is not None and f.licence_valid_until >= date.today())
            w["next_parties"].append({"id": f.id, "name": f.name, "eligible": ok,
                                      "note": None if ok else "licence expired"})

    if a.role == "generator":
        w["my_batches"] = [{"batch_id": b.id, "category": b.category, "mass_kg": b.net_mass_g / 1000,
                            "status": b.status, "custodian": b.custodian_id}
                           for b in db.query(Batch).filter_by(source_facility_id=fac)]

    if a.role == "recycler":
        certified = {c.claim_id for c in db.query(RecoveryCertificate)}
        for cl in db.query(RecoveryClaim):
            o = db.get(MaterialOutput, cl.output_id)
            r = db.get(ProcessingRun, o.run_id)
            if r.facility_id == fac and cl.claim_id not in certified:
                w["to_certify"].append({"claim_id": cl.claim_id, "material": o.material, "mass_kg": cl.mass_g / 1000})

    if a.role == "buyer":
        for c in db.query(RecoveryCertificate):
            p = json.loads(c.payload)["claim"]
            w["certificates"].append({"id": c.id, "material": p["material"], "mass_kg": p["mass_kg"],
                                      "status": c.status, "retired_by": c.retired_by})

    if a.role == "auditor":
        alerts = db.query(AuditAlert).all()
        w["audit"] = {"open_alerts": sum(1 for x in alerts if x.status in ("open", "investigating")),
                      "critical_open": sum(1 for x in alerts if x.severity == "critical"
                                           and x.status in ("open", "investigating"))}
    return w