import hashlib, json
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import Base, engine, get_db, SessionLocal
from .models import Facility, Batch, Transfer, AuditEvent, AuditAlert, utcnow

UNIT_TO_G = {"g": Decimal(1), "kg": Decimal(1000), "t": Decimal(1_000_000)}
RECEIPT_TOLERANCE_PCT = Decimal("0.5")   # demo threshold, not a regulatory standard
CRITICAL_PCT = Decimal("2.0")
OVERDUE_HOURS = 24
GENESIS = "0" * 64

def to_grams(value: Decimal, unit: str) -> int:
    return int((value * UNIT_TO_G[unit]).to_integral_value())

# ---------- seed (clearly labelled demo data) ----------
def seed(db: Session):
    if db.query(Facility).count():
        return
    db.add_all([
        Facility(id="CC-A", name="Collection Centre A (demo)", kind="collection"),
        Facility(id="F1", name="Recycler Alpha (demo)", kind="processor",
                 licence_no="DEMO-LIC-001", licence_valid_until=date(2027, 3, 31),
                 accepted_categories="IT,TELECOM,CONSUMER", capacity_g=2_000_000),
        Facility(id="F2", name="Recycler Beta (demo)", kind="processor",
                 licence_no="DEMO-LIC-002", licence_valid_until=date(2027, 6, 30),
                 accepted_categories="IT,CONSUMER", capacity_g=1_000_000),
        Facility(id="F3", name="Recycler Gamma (demo, EXPIRED)", kind="processor",
                 licence_no="DEMO-LIC-003", licence_valid_until=date(2026, 9, 30),
                 accepted_categories="IT,TELECOM,CONSUMER", capacity_g=3_000_000),
    ])
    db.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    yield

app = FastAPI(title="E-Waste Ledger API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"])

# ---------- schemas ----------
class Mass(BaseModel):
    value: Decimal = Field(gt=0)
    unit: Literal["g", "kg", "t"] = "kg"

class BatchIn(BaseModel):
    id: str = Field(pattern=r"^EW-\d{4}-\d{4}$")
    source_facility_id: str
    category: Literal["IT", "TELECOM", "CONSUMER"]
    mass: Mass
    operator: str
    weighed_at: datetime

class TransferIn(BaseModel):
    id: str
    batch_id: str
    receiver_id: str
    mass: Mass
    actor: str

class ReceiveIn(BaseModel):
    receiver_id: str
    mass: Mass
    actor: str

# ---------- helpers ----------
def record_event(db: Session, batch_id: str, event_type: str, payload: dict, actor: str):
    last = (db.query(AuditEvent).filter_by(batch_id=batch_id)
            .order_by(AuditEvent.id.desc()).first())
    prev = last.event_hash if last else GENESIS
    canonical = json.dumps(
        {"batch_id": batch_id, "type": event_type, "actor": actor,
         "payload": payload, "prev": prev},
        sort_keys=True, separators=(",", ":"), default=str)
    ev = AuditEvent(batch_id=batch_id, event_type=event_type, actor=actor,
                    payload=canonical, prev_hash=prev,
                    event_hash=hashlib.sha256(canonical.encode()).hexdigest())
    db.add(ev)
    db.flush()
    return ev

def commit_or_409(db: Session):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate record rejected by database constraint")

def licence_ok(f: Facility) -> bool:
    return f.licence_valid_until is not None and f.licence_valid_until >= date.today()

def batch_out(db: Session, b: Batch) -> dict:
    return {
        "id": b.id, "category": b.category, "status": b.status,
        "source": b.source_facility_id, "custodian": b.custodian_id,
        "net_mass_kg": b.net_mass_g / 1000, "original_reading": b.original_reading,
        "operator": b.operator, "weighed_at": b.weighed_at,
        "transfers": [{
            "id": t.id, "from": t.sender_id, "to": t.receiver_id, "status": t.status,
            "dispatch_kg": t.dispatch_mass_g / 1000,
            "receipt_kg": None if t.receipt_mass_g is None else t.receipt_mass_g / 1000,
            "dispatched_at": t.dispatched_at, "received_at": t.received_at,
        } for t in db.query(Transfer).filter_by(batch_id=b.id)],
        "events": [{
            "id": e.id, "type": e.event_type, "actor": e.actor, "hash": e.event_hash,
            "prev_hash": e.prev_hash, "chain_status": e.chain_status, "at": e.created_at,
        } for e in db.query(AuditEvent).filter_by(batch_id=b.id).order_by(AuditEvent.id)],
        "alerts": [{
            "id": a.id, "rule": a.rule, "severity": a.severity,
            "message": a.message, "status": a.status,
        } for a in db.query(AuditAlert).filter_by(batch_id=b.id)],
    }

# ---------- endpoints ----------
@app.get("/health")
def health():
    return {"status": "ok", "service": "e-waste-ledger"}

@app.get("/api/v1/facilities")
def facilities(db: Session = Depends(get_db)):
    return [{**{c: getattr(f, c) for c in
                ("id", "name", "kind", "licence_no", "licence_valid_until",
                 "accepted_categories", "capacity_g", "verification")},
             "licence_valid": licence_ok(f) if f.kind == "processor" else None}
            for f in db.query(Facility)]

@app.post("/api/v1/batches", status_code=201)
def create_batch(body: BatchIn, db: Session = Depends(get_db)):
    if db.get(Batch, body.id):
        raise HTTPException(409, "Batch ID already exists")
    src = db.get(Facility, body.source_facility_id)
    if not src or src.kind != "collection":
        raise HTTPException(422, "Source must be a registered collection centre")
    g = to_grams(body.mass.value, body.mass.unit)
    b = Batch(id=body.id, source_facility_id=src.id, category=body.category,
              net_mass_g=g, original_reading=f"{body.mass.value} {body.mass.unit}",
              operator=body.operator, weighed_at=body.weighed_at, custodian_id=src.id)
    db.add(b)
    db.flush()
    record_event(db, b.id, "BATCH_REGISTERED",
                 {"mass_g": g, "category": b.category, "source": src.id,
                  "reading": b.original_reading}, body.operator)
    commit_or_409(db)
    return batch_out(db, b)

@app.get("/api/v1/batches")
def list_batches(db: Session = Depends(get_db)):
    return [{"id": b.id, "category": b.category, "status": b.status,
             "custodian": b.custodian_id, "net_mass_kg": b.net_mass_g / 1000}
            for b in db.query(Batch).order_by(Batch.created_at.desc())]

@app.get("/api/v1/batches/{batch_id}")
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    b = db.get(Batch, batch_id)
    if not b:
        raise HTTPException(404, "Batch not found")
    return batch_out(db, b)

@app.post("/api/v1/transfers", status_code=201)
def dispatch(body: TransferIn, db: Session = Depends(get_db)):
    b = db.get(Batch, body.batch_id)
    if not b:
        raise HTTPException(404, "Batch not found")
    if db.get(Transfer, body.id):
        raise HTTPException(409, "Transfer ID already exists")
    if b.status not in ("collected", "received"):
        raise HTTPException(409, f"Batch is '{b.status}'; cannot dispatch")
    r = db.get(Facility, body.receiver_id)
    if not r:
        raise HTTPException(422, "Unknown receiver")
    if r.kind == "processor":     # compliance gate
        if not licence_ok(r):
            raise HTTPException(422, f"{r.id} licence expired/missing; dispatch blocked")
        if b.category not in r.accepted_categories.split(","):
            raise HTTPException(422, f"{r.id} is not authorised for category {b.category}")
    g = to_grams(body.mass.value, body.mass.unit)
    t = Transfer(id=body.id, batch_id=b.id, sender_id=b.custodian_id,
                 receiver_id=r.id, dispatch_mass_g=g, dispatched_at=utcnow())
    db.add(t)
    b.status = "in_transit"
    record_event(db, b.id, "DISPATCHED",
                 {"transfer_id": t.id, "from": t.sender_id, "to": r.id, "mass_g": g},
                 body.actor)
    commit_or_409(db)
    return batch_out(db, b)

@app.post("/api/v1/transfers/{transfer_id}/receive")
def receive(transfer_id: str, body: ReceiveIn, db: Session = Depends(get_db)):
    t = db.get(Transfer, transfer_id)
    if not t:
        raise HTTPException(404, "Transfer not found")
    if t.status != "dispatched":
        raise HTTPException(409, "Transfer already received: duplicate receipt blocked")
    if body.receiver_id != t.receiver_id:
        raise HTTPException(403, "Receiver does not match the intended receiver")
    g = to_grams(body.mass.value, body.mass.unit)
    t.receipt_mass_g, t.received_at = g, utcnow()
    diff = t.dispatch_mass_g - g
    pct = Decimal(abs(diff)) * 100 / Decimal(t.dispatch_mass_g)
    b = db.get(Batch, t.batch_id)
    b.custodian_id, b.status = t.receiver_id, "received"
    if pct > RECEIPT_TOLERANCE_PCT:
        t.status = "disputed"
        db.add(AuditAlert(
            batch_id=b.id, transfer_id=t.id, rule="RECEIPT_WEIGHT_MISMATCH",
            severity="critical" if pct > CRITICAL_PCT else "warning",
            message=(f"Dispatched {t.dispatch_mass_g/1000} kg, received {g/1000} kg "
                     f"(gap {diff/1000} kg, {pct:.2f}%, tolerance {RECEIPT_TOLERANCE_PCT}%). "
                     "Both readings preserved; investigate."),
            measured=json.dumps({"dispatch_g": t.dispatch_mass_g, "receipt_g": g,
                                 "diff_g": diff, "pct": str(round(pct, 3))})))
    else:
        t.status = "received"
    record_event(db, b.id, "RECEIVED",
                 {"transfer_id": t.id, "mass_g": g, "diff_g": diff,
                  "transfer_status": t.status}, body.actor)
    commit_or_409(db)
    return batch_out(db, b)

@app.get("/api/v1/audits")
def audits(db: Session = Depends(get_db)):
    cutoff = utcnow() - timedelta(hours=OVERDUE_HOURS)
    overdue = db.query(Transfer).filter(Transfer.status == "dispatched",
                                        Transfer.dispatched_at < cutoff).all()
    return {
        "alerts": [{"id": a.id, "batch_id": a.batch_id, "rule": a.rule,
                    "severity": a.severity, "message": a.message, "status": a.status}
                   for a in db.query(AuditAlert).order_by(AuditAlert.id.desc())],
        "missing_handovers": [{"transfer_id": t.id, "batch_id": t.batch_id,
                               "to": t.receiver_id, "dispatched_at": t.dispatched_at}
                              for t in overdue],
    }

@app.get("/api/v1/batches/{batch_id}/verify-chain")
def verify_chain(batch_id: str, db: Session = Depends(get_db)):
    prev = GENESIS
    events = (db.query(AuditEvent).filter_by(batch_id=batch_id)
              .order_by(AuditEvent.id).all())
    for e in events:
        if e.prev_hash != prev or json.loads(e.payload)["prev"] != prev:
            return {"valid": False, "broken_at_event": e.id, "reason": "chain link mismatch"}
        if hashlib.sha256(e.payload.encode()).hexdigest() != e.event_hash:
            return {"valid": False, "broken_at_event": e.id, "reason": "payload tampered"}
        prev = e.event_hash
    return {"valid": True, "events": len(events), "head_hash": prev}