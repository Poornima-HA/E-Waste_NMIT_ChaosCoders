"""Independent inventory reconciliation: system vs physical vs claimed."""
import hashlib
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, get_db
from .models import Batch, Facility, Transfer, utcnow
from .recovery import MaterialOutput, ProcessingRun

UNIT_TO_G = {"g": Decimal(1), "kg": Decimal(1000), "t": Decimal(1_000_000)}
TOL_PCT = Decimal("1.0")       # demo thresholds, not validated operating standards
CRIT_PCT = Decimal("3.0")
FEEDSTOCK = "e-waste feedstock"

router = APIRouter(tags=["inventory"])


class InventoryCount(Base):
    __tablename__ = "inventory_counts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    material: Mapped[str]
    counted_g: Mapped[int]
    counted_by: Mapped[str]
    method: Mapped[str]
    evidence_hash: Mapped[str] = mapped_column(String(64))
    counted_at: Mapped[datetime] = mapped_column(default=utcnow)


class Mass(BaseModel):
    value: Decimal = Field(ge=0)
    unit: Literal["g", "kg", "t"] = "kg"


class CountIn(BaseModel):
    facility_id: str
    material: str = Field(min_length=2, max_length=40)
    counted: Mass
    counted_by: str
    method: Literal["weighbridge", "platform_scale", "visual_estimate"] = "platform_scale"
    evidence_ref: str = Field(min_length=3)


def system_view(db: Session):
    """System inventory derived ONLY from recorded movements."""
    s = defaultdict(lambda: {"system_g": 0, "disputed_g": 0, "claimed_g": 0})

    # recovered materials at the processing facility (+ what has been claimed from them)
    rows = (db.query(MaterialOutput, ProcessingRun)
            .join(ProcessingRun, MaterialOutput.run_id == ProcessingRun.id).all())
    for out, run in rows:
        r = s[(run.facility_id, out.material)]
        r["system_g"] += out.mass_g
        r["claimed_g"] += out.allocated_g

    # unprocessed e-waste sitting at a facility (in-transit batches belong to nobody yet)
    for b in db.query(Batch).filter(Batch.status.in_(["collected", "received"])).all():
        r = s[(b.custodian_id, FEEDSTOCK)]
        t = (db.query(Transfer).filter_by(batch_id=b.id, receiver_id=b.custodian_id)
             .filter(Transfer.receipt_mass_g.isnot(None))
             .order_by(Transfer.received_at.desc()).first())
        if t is None:
            r["system_g"] += b.net_mass_g          # still at the collection centre
        elif t.status == "disputed":
            r["disputed_g"] += t.receipt_mass_g    # NOT counted as confirmed stock
        else:
            r["system_g"] += t.receipt_mass_g
    return s


def assess(sys_g: int, phys_g: int | None, clm_g: int):
    if phys_g is None:
        return "not_counted", [], None
    findings = []
    diff = phys_g - sys_g
    pct = (Decimal(diff) * 100 / Decimal(sys_g)) if sys_g else (Decimal(100) if phys_g else Decimal(0))

    if abs(pct) > TOL_PCT:
        sev = "critical" if abs(pct) > CRIT_PCT else "warning"
        if diff < 0:
            findings.append({"rule": "STOCK_SHORTFALL", "severity": sev,
                             "message": f"Physical count is {-diff/1000} kg ({-pct:.2f}%) below system "
                                        "records: material recorded but not on the floor."})
        else:
            findings.append({"rule": "UNRECORDED_STOCK", "severity": sev,
                             "message": f"Physical count is {diff/1000} kg ({pct:.2f}%) above system "
                                        "records: material of unknown origin."})

    if clm_g > phys_g and Decimal(clm_g - phys_g) * 100 / Decimal(clm_g) > TOL_PCT:
        findings.append({"rule": "GHOST_INVENTORY", "severity": "critical",
                         "message": f"{clm_g/1000} kg is claimed as recovered but only "
                                    f"{phys_g/1000} kg is physically present."})

    if any(f["severity"] == "critical" for f in findings):
        status = "critical"
    elif findings:
        status = "warning"
    else:
        status = "reconciled"
    return status, findings, float(round(pct, 3))


@router.get("/api/v1/inventory/reconciliation")
def reconciliation(db: Session = Depends(get_db)):
    s = system_view(db)
    latest = {}
    for c in db.query(InventoryCount).order_by(InventoryCount.id).all():
        latest[(c.facility_id, c.material)] = c      # most recent count wins

    rows = []
    for k in sorted(set(s) | set(latest)):
        v = s.get(k, {"system_g": 0, "disputed_g": 0, "claimed_g": 0})
        c = latest.get(k)
        status, findings, pct = assess(v["system_g"], c.counted_g if c else None, v["claimed_g"])
        rows.append({
            "facility_id": k[0], "material": k[1],
            "system_kg": v["system_g"] / 1000, "disputed_kg": v["disputed_g"] / 1000,
            "claimed_kg": v["claimed_g"] / 1000,
            "physical_kg": c.counted_g / 1000 if c else None,
            "difference_kg": (c.counted_g - v["system_g"]) / 1000 if c else None,
            "difference_pct": pct, "status": status, "findings": findings,
            "last_count": {"counted_by": c.counted_by, "method": c.method,
                           "counted_at": c.counted_at, "evidence_hash": c.evidence_hash} if c else None,
        })
    return {"tolerance": {"pass_pct": float(TOL_PCT), "critical_pct": float(CRIT_PCT),
                          "note": "demonstration thresholds, not validated operating standards"},
            "rows": rows}


@router.post("/api/v1/inventory/counts", status_code=201)
def add_count(body: CountIn, db: Session = Depends(get_db)):
    if not db.get(Facility, body.facility_id):
        raise HTTPException(404, "Facility not found")
    material = body.material.strip().lower()
    c = InventoryCount(
        facility_id=body.facility_id, material=material,
        counted_g=int((body.counted.value * UNIT_TO_G[body.counted.unit]).to_integral_value()),
        counted_by=body.counted_by, method=body.method,
        evidence_hash=hashlib.sha256(body.evidence_ref.strip().encode()).hexdigest())
    db.add(c)
    db.commit()
    rec = reconciliation(db)
    row = next((r for r in rec["rows"]
                if r["facility_id"] == body.facility_id and r["material"] == material), None)
    return {"count_id": c.id, "row": row}


@router.get("/api/v1/inventory/counts")
def list_counts(db: Session = Depends(get_db)):
    return [{"id": c.id, "facility_id": c.facility_id, "material": c.material,
             "counted_kg": c.counted_g / 1000, "counted_by": c.counted_by,
             "method": c.method, "counted_at": c.counted_at}
            for c in db.query(InventoryCount).order_by(InventoryCount.id.desc())]