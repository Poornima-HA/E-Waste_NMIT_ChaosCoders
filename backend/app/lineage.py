"""Batch split / merge with mass conservation and cryptographic parent links."""
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, Integer, or_
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, get_db
from .models import AuditEvent, Batch, Transfer, utcnow
from .recovery import append_event

UNIT_TO_G = {"g": Decimal(1), "kg": Decimal(1000), "t": Decimal(1_000_000)}
ID_RE = r"^EW-\d{4}-[A-Z0-9-]{3,14}$"
SPLIT_LOSS_TOL_PCT = Decimal("0.5")        # demo threshold
OPEN = ("collected", "received")

router = APIRouter(tags=["lineage"])


class BatchLineage(Base):
    __tablename__ = "batch_lineage"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    child_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    mass_g: Mapped[int]
    relation: Mapped[str]                   # split | merge
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Mass(BaseModel):
    value: Decimal = Field(gt=0)
    unit: Literal["g", "kg", "t"] = "kg"


class ChildIn(BaseModel):
    id: str = Field(pattern=ID_RE)
    mass: Mass


class SplitIn(BaseModel):
    children: list[ChildIn] = Field(min_length=2, max_length=10)
    operator: str
    reason: str = Field(min_length=3)


class MergeIn(BaseModel):
    id: str = Field(pattern=ID_RE)
    parent_ids: list[str] = Field(min_length=2, max_length=10)
    operator: str
    reason: str = Field(min_length=3)


def grams(m: Mass) -> int:
    return int((m.value * UNIT_TO_G[m.unit]).to_integral_value())


def head(db: Session, batch_id: str) -> str:
    e = (db.query(AuditEvent).filter_by(batch_id=batch_id)
         .order_by(AuditEvent.id.desc()).first())
    return e.event_hash if e else "0" * 64


def current_mass(db: Session, b: Batch) -> int:
    """Mass the custodian actually holds: latest receipt, or the original weighing."""
    t = (db.query(Transfer).filter_by(batch_id=b.id, receiver_id=b.custodian_id)
         .filter(Transfer.receipt_mass_g.isnot(None))
         .order_by(Transfer.received_at.desc()).first())
    if t is None:
        return b.net_mass_g
    if t.status == "disputed":
        raise HTTPException(409, f"{b.id} has a disputed receipt ({t.id}); resolve it before split/merge")
    return t.receipt_mass_g


@router.get("/api/v1/batches/{batch_id}/lineage")
def lineage(batch_id: str, db: Session = Depends(get_db)):
    root = db.get(Batch, batch_id)
    if not root:
        raise HTTPException(404, "Batch not found")
    nodes, edges, seen, stack = {}, {}, set(), [batch_id]
    while stack:                                   # whole connected family
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        b = db.get(Batch, cur)
        nodes[cur] = {"id": b.id, "category": b.category, "status": b.status,
                      "custodian": b.custodian_id, "source": b.source_facility_id,
                      "mass_kg": b.net_mass_g / 1000}
        for e in db.query(BatchLineage).filter(
                or_(BatchLineage.parent_id == cur, BatchLineage.child_id == cur)):
            edges[e.id] = {"parent_id": e.parent_id, "child_id": e.child_id,
                           "mass_kg": e.mass_g / 1000, "relation": e.relation}
            stack.append(e.child_id if e.parent_id == cur else e.parent_id)

    available = None
    if root.status in OPEN:
        try:
            available = current_mass(db, root) / 1000
        except HTTPException:
            available = None
    return {"root": batch_id, "available_kg": available,
            "nodes": list(nodes.values()), "edges": list(edges.values())}


@router.post("/api/v1/batches/{batch_id}/split", status_code=201)
def split(batch_id: str, body: SplitIn, db: Session = Depends(get_db)):
    p = db.get(Batch, batch_id)
    if not p:
        raise HTTPException(404, "Batch not found")
    if p.status not in OPEN:
        raise HTTPException(409, f"Only collected/received batches can be split (status: {p.status})")
    avail = current_mass(db, p)

    ids = [c.id for c in body.children]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Child IDs must be unique")
    for i in ids:
        if db.get(Batch, i):
            raise HTTPException(409, f"Batch ID {i} already exists")

    masses = {c.id: grams(c.mass) for c in body.children}
    total = sum(masses.values())
    if total > avail:
        raise HTTPException(409, f"MASS_CREATION blocked: children total {total/1000} kg exceeds "
                                 f"the {avail/1000} kg the parent holds")
    loss = avail - total
    loss_pct = Decimal(loss) * 100 / Decimal(avail)
    if loss_pct > SPLIT_LOSS_TOL_PCT:
        raise HTTPException(409, f"UNEXPLAINED_SPLIT_LOSS blocked: {loss/1000} kg ({loss_pct:.2f}%) "
                                 f"missing, tolerance {SPLIT_LOSS_TOL_PCT}%")

    append_event(db, p.id, "SPLIT",
                 {"children": masses, "parent_mass_g": avail, "split_loss_g": loss,
                  "reason": body.reason}, body.operator)
    parent_head = head(db, p.id)

    for cid, g in masses.items():
        db.add(Batch(id=cid, source_facility_id=p.source_facility_id, category=p.category,
                     net_mass_g=g, original_reading=f"split from {p.id}", operator=body.operator,
                     weighed_at=utcnow(), custodian_id=p.custodian_id, status=p.status))
    db.flush()
    for cid, g in masses.items():
        db.add(BatchLineage(parent_id=p.id, child_id=cid, mass_g=g, relation="split"))
        append_event(db, cid, "LINEAGE_CREATED",
                     {"relation": "split", "parents": {p.id: {"mass_g": g, "parent_head_hash": parent_head}},
                      "mass_g": g, "reason": body.reason}, body.operator)
    p.status = "split"
    db.commit()
    return lineage(p.id, db)


@router.post("/api/v1/batches/merge", status_code=201)
def merge(body: MergeIn, db: Session = Depends(get_db)):
    if db.get(Batch, body.id):
        raise HTTPException(409, f"Batch ID {body.id} already exists")
    if len(set(body.parent_ids)) != len(body.parent_ids):
        raise HTTPException(422, "Parent IDs must be unique")
    parents = []
    for pid in body.parent_ids:
        b = db.get(Batch, pid)
        if not b:
            raise HTTPException(404, f"Batch {pid} not found")
        if b.status not in OPEN:
            raise HTTPException(409, f"{pid} cannot be merged (status: {b.status})")
        parents.append(b)
    if len({b.custodian_id for b in parents}) != 1:
        raise HTTPException(409, "All batches must be held by the same facility to merge")
    if len({b.category for b in parents}) != 1:
        raise HTTPException(409, "All batches must have the same waste category to merge")

    masses = {b.id: current_mass(db, b) for b in parents}
    total = sum(masses.values())
    first = parents[0]
    child = Batch(id=body.id, source_facility_id=first.source_facility_id, category=first.category,
                  net_mass_g=total, original_reading=f"merged from {len(parents)} batches",
                  operator=body.operator, weighed_at=utcnow(), custodian_id=first.custodian_id,
                  status=first.status)
    db.add(child)
    db.flush()

    links = {}
    for b in parents:
        append_event(db, b.id, "MERGED_INTO",
                     {"child": body.id, "mass_g": masses[b.id], "reason": body.reason}, body.operator)
        links[b.id] = {"mass_g": masses[b.id], "parent_head_hash": head(db, b.id)}
        db.add(BatchLineage(parent_id=b.id, child_id=body.id, mass_g=masses[b.id], relation="merge"))
        b.status = "merged"
    append_event(db, body.id, "LINEAGE_CREATED",
                 {"relation": "merge", "parents": links, "mass_g": total, "reason": body.reason},
                 body.operator)
    db.commit()
    return lineage(body.id, db)