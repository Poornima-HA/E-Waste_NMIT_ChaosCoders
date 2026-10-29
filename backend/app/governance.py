"""Alert resolution workflow + judge-facing metrics (all computed live)."""
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, Session, mapped_column

from .blockchain import BlockchainReceipt
from .db import Base, get_db
from .inventory import reconciliation
from .lineage import BatchLineage
from .models import AuditAlert, AuditEvent, Batch, OptimizationRun, Transfer, utcnow
from .optimization_routes import quantum_benchmarks
from .recovery import ClaimAttempt, ProcessingRun, RecoveryClaim, append_event

ROOT = Path(__file__).resolve().parents[2]
router = APIRouter(tags=["governance"])

# closed alerts stay closed: a new finding must be raised instead of reopening history
TRANSITIONS = {
    "open": {"investigating", "resolved", "false_positive"},
    "investigating": {"resolved", "false_positive"},
}


class AlertResolution(Base):
    __tablename__ = "alert_resolutions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("audit_alerts.id"))
    from_status: Mapped[str]
    to_status: Mapped[str]
    reviewer: Mapped[str]
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ResolveIn(BaseModel):
    status: Literal["investigating", "resolved", "false_positive"]
    reviewer: str = Field(min_length=2)
    note: str = Field(min_length=10)


def _res_out(r: AlertResolution) -> dict:
    return {"id": r.id, "alert_id": r.alert_id, "from": r.from_status, "to": r.to_status,
            "reviewer": r.reviewer, "note": r.note, "at": r.created_at}


@router.post("/api/v1/audits/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, body: ResolveIn, db: Session = Depends(get_db)):
    a = db.get(AuditAlert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found")
    if a.status not in TRANSITIONS:
        raise HTTPException(409, f"Alert is already '{a.status}'. Closed alerts stay closed; "
                                 "raise a new finding instead.")
    if body.status not in TRANSITIONS[a.status]:
        raise HTTPException(409, f"Invalid transition '{a.status}' → '{body.status}'. "
                                 f"Allowed: {', '.join(sorted(TRANSITIONS[a.status]))}.")
    r = AlertResolution(alert_id=a.id, from_status=a.status, to_status=body.status,
                        reviewer=body.reviewer, note=body.note.strip())
    db.add(r)
    append_event(db, a.batch_id, f"ALERT_{body.status.upper()}",
                 {"alert_id": a.id, "rule": a.rule, "from": a.status, "to": body.status,
                  "note": body.note.strip()}, body.reviewer)
    a.status = body.status
    db.commit()
    hist = db.query(AlertResolution).filter_by(alert_id=a.id).order_by(AlertResolution.id).all()
    return {"alert_id": a.id, "status": a.status, "history": [_res_out(h) for h in hist]}


@router.get("/api/v1/audits/resolutions")
def list_resolutions(db: Session = Depends(get_db)):
    return [_res_out(r) for r in db.query(AlertResolution).order_by(AlertResolution.id)]


def _junit():
    p = ROOT / "evidence" / "test_report.xml"
    if not p.exists():
        return None
    root = ET.parse(p).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    t = {k: sum(int(s.get(k, 0)) for s in suites) for k in ("tests", "failures", "errors", "skipped")}
    t["passed"] = t["tests"] - t["failures"] - t["errors"] - t["skipped"]
    t["report"] = "evidence/test_report.xml"
    t["generated"] = suites[0].get("timestamp") if suites else None
    return t


@router.get("/api/v1/metrics")
def metrics(db: Session = Depends(get_db)):
    from .main import OVERDUE_HOURS          # lazy import avoids a circular import

    batches = db.query(Batch).all()
    child_ids = {e.child_id for e in db.query(BatchLineage).all()}
    originals = [b for b in batches if b.id not in child_ids]   # avoid double-counting split/merge
    transfers = db.query(Transfer).all()
    received = [t for t in transfers if t.receipt_mass_g is not None]
    cutoff = utcnow() - timedelta(hours=OVERDUE_HOURS)
    runs = db.query(ProcessingRun).all()
    attempts = db.query(ClaimAttempt).all()
    rejected = [a for a in attempts if a.decision == "rejected"]
    accepted = db.query(RecoveryClaim).all()
    alerts = db.query(AuditAlert).all()
    events = db.query(AuditEvent).all()
    receipts = db.query(BlockchainReceipt).all()

    by_rule: dict[str, int] = {}
    for a in rejected:
        by_rule[a.rule or "UNKNOWN"] = by_rule.get(a.rule or "UNKNOWN", 0) + 1

    inv_rows = reconciliation(db)["rows"]
    inv = {s: sum(1 for r in inv_rows if r["status"] == s)
           for s in ("reconciled", "warning", "critical", "not_counted")}

    input_g = sum(r.input_g for r in runs)
    recovered_g = sum(r.recovered_g for r in runs)

    opt = None
    latest = db.query(OptimizationRun).order_by(OptimizationRun.created_at.desc()).first()
    if latest:
        rec = json.loads(latest.record)

        def per_kg(p):
            kg = sum(p["load_kg"].values())
            return round(p["total_cost_inr"] / kg, 2) if kg else None

        o, b = rec["optimized"], rec["baseline_nearest"]
        opt = {"run_id": latest.id, "status": latest.status,
               "guarantee": rec["solver"]["guarantee"],
               "optimized_assigned": f"{o['assigned']}/{o['total_batches']}",
               "baseline_assigned": f"{b['assigned']}/{b['total_batches']}",
               "optimized_feasible": o["feasible"], "baseline_feasible": b["feasible"],
               "optimized_inr_per_kg": per_kg(o), "baseline_inr_per_kg": per_kg(b)}
        if opt["optimized_inr_per_kg"] and opt["baseline_inr_per_kg"]:
            opt["per_kg_saving_pct"] = round(
                (opt["baseline_inr_per_kg"] - opt["optimized_inr_per_kg"])
                / opt["baseline_inr_per_kg"] * 100, 2)

    qb = quantum_benchmarks()

    return {
        "operations": {
            "batches": len(batches), "original_batches": len(originals),
            "collected_kg": sum(b.net_mass_g for b in originals) / 1000,
            "processed_input_kg": input_g / 1000, "recovered_kg": recovered_g / 1000,
            "avg_yield_pct": round(recovered_g * 100 / input_g, 2) if input_g else None,
        },
        "custody": {
            "transfers": len(transfers), "received": len(received),
            "disputed": sum(1 for t in transfers if t.status == "disputed"),
            "missing_handovers": sum(1 for t in transfers
                                     if t.status == "dispatched" and t.dispatched_at < cutoff),
            "total_receipt_gap_kg": sum(t.dispatch_mass_g - t.receipt_mass_g for t in received) / 1000,
        },
        "mass_balance": {
            "runs": len(runs),
            **{s: sum(1 for r in runs if r.balance_status == s) for s in ("pass", "warning", "critical")},
            "unexplained_kg": sum(r.variance_g for r in runs) / 1000,
        },
        "claims": {
            "accepted": len(accepted), "accepted_kg": sum(c.mass_g for c in accepted) / 1000,
            "blocked": len(rejected), "blocked_kg": sum(a.mass_g for a in rejected) / 1000,
            "blocked_by_rule": by_rule,
        },
        "inventory": inv,
        "alerts": {
            "total": len(alerts),
            **{s: sum(1 for a in alerts if a.status == s)
               for s in ("open", "investigating", "resolved", "false_positive")},
            "critical_open": sum(1 for a in alerts
                                 if a.severity == "critical" and a.status in ("open", "investigating")),
        },
        "blockchain": {
            "events": len(events),
            "anchored_events": sum(1 for e in events if e.chain_status == "anchored"),
            "confirmed_receipts": sum(1 for r in receipts if r.status == "confirmed"),
            "failed_receipts": sum(1 for r in receipts if r.status == "failed"),
        },
        "optimization": opt,
        "quantum": {"benchmarks": len(qb), "matches_optimum": sum(1 for q in qb if q["matches_optimum"]),
                    "cloud_jobs": sum(len(q["job_ids"]) for q in qb)},
        "tests": _junit(),
    }