"""Batch-level cost records and cost-per-kg metrics."""
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, get_db
from .models import Batch, utcnow
from .recovery import ProcessingRun, append_event

router = APIRouter(tags=["costs"])
CATEGORIES = ("transport", "processing", "disposal", "handling")


class CostRecord(Base):
    __tablename__ = "cost_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    category: Mapped[str]
    amount_paise: Mapped[int]                 # integer paise: no float rounding
    reference: Mapped[str]
    recorded_by: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class CostIn(BaseModel):
    batch_id: str
    category: Literal["transport", "processing", "disposal", "handling"]
    amount_inr: Decimal = Field(gt=0, le=Decimal("1000000000"))
    reference: str = Field(min_length=3)
    recorded_by: str


def summary(db: Session, b: Batch) -> dict:
    recs = db.query(CostRecord).filter_by(batch_id=b.id).order_by(CostRecord.id).all()
    runs = db.query(ProcessingRun).filter_by(batch_id=b.id).all()
    total = sum(r.amount_paise for r in recs)
    by_cat = {c: sum(r.amount_paise for r in recs if r.category == c) / 100 for c in CATEGORIES}
    collected_kg = b.net_mass_g / 1000
    recovered_kg = sum(r.recovered_g for r in runs) / 1000
    return {
        "batch_id": b.id, "total_inr": total / 100, "by_category_inr": by_cat,
        "collected_kg": collected_kg, "recovered_kg": recovered_kg,
        "cost_per_kg_collected_inr": round(total / 100 / collected_kg, 2) if collected_kg else None,
        "cost_per_kg_recovered_inr": round(total / 100 / recovered_kg, 2) if recovered_kg else None,
        "records": [{"id": r.id, "category": r.category, "amount_inr": r.amount_paise / 100,
                     "reference": r.reference, "recorded_by": r.recorded_by,
                     "created_at": r.created_at} for r in recs],
    }


@router.post("/api/v1/costs", status_code=201)
def add_cost(body: CostIn, db: Session = Depends(get_db)):
    b = db.get(Batch, body.batch_id)
    if not b:
        raise HTTPException(404, "Batch not found")
    paise = int((body.amount_inr * 100).to_integral_value())
    db.add(CostRecord(batch_id=b.id, category=body.category, amount_paise=paise,
                      reference=body.reference.strip(), recorded_by=body.recorded_by))
    append_event(db, b.id, "COST_RECORDED",
                 {"category": body.category, "amount_paise": paise,
                  "reference": body.reference.strip()}, body.recorded_by)
    db.commit()
    return summary(db, b)


@router.get("/api/v1/costs/batch/{batch_id}")
def batch_costs(batch_id: str, db: Session = Depends(get_db)):
    b = db.get(Batch, batch_id)
    if not b:
        raise HTTPException(404, "Batch not found")
    return summary(db, b)


@router.get("/api/v1/costs/summary")
def all_costs(db: Session = Depends(get_db)):
    ids = {r.batch_id for r in db.query(CostRecord).all()}
    return [summary(db, db.get(Batch, i)) for i in sorted(ids)]