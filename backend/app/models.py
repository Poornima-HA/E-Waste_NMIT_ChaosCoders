from datetime import datetime, date, timezone
from sqlalchemy import String, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

class Facility(Base):
    __tablename__ = "facilities"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str]
    kind: Mapped[str]                       # collection | processor
    licence_no: Mapped[str | None]
    licence_valid_until: Mapped[date | None]
    accepted_categories: Mapped[str] = mapped_column(default="")   # "IT,TELECOM"
    capacity_g: Mapped[int] = mapped_column(Integer, default=0)
    verification: Mapped[str] = mapped_column(default="demo_unverified")

class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    category: Mapped[str]
    net_mass_g: Mapped[int]                 # original reading, never overwritten
    original_reading: Mapped[str]
    operator: Mapped[str]
    weighed_at: Mapped[datetime]
    custodian_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    status: Mapped[str] = mapped_column(default="collected")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

class Transfer(Base):
    __tablename__ = "transfers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    sender_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    receiver_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    dispatch_mass_g: Mapped[int]
    dispatched_at: Mapped[datetime]
    receipt_mass_g: Mapped[int | None]
    received_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(default="dispatched")  # dispatched|received|disputed

class AuditEvent(Base):                     # append-only, hash-chained
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    event_type: Mapped[str]
    actor: Mapped[str]
    payload: Mapped[str] = mapped_column(Text)      # canonical JSON incl. prev hash
    prev_hash: Mapped[str] = mapped_column(String(64))
    event_hash: Mapped[str] = mapped_column(String(64), unique=True)
    chain_status: Mapped[str] = mapped_column(default="not_submitted")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

class AuditAlert(Base):
    __tablename__ = "audit_alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"))
    transfer_id: Mapped[str | None]
    rule: Mapped[str]
    severity: Mapped[str]                   # warning | critical
    message: Mapped[str] = mapped_column(Text)
    measured: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(default="open")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)