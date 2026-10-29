"""Material-flow analytics: where every kilogram went (computed live from records)."""
import json
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .certificates import RecoveryCertificate
from .db import get_db
from .models import Batch, Transfer
from .recovery import MaterialOutput, ProcessingRun

router = APIRouter(tags=["analytics"])

STAGES = [
    ("At collection centre", "#64748b"),
    ("In transit", "#f59e0b"),
    ("Disputed receipt", "#dc2626"),
    ("Received, awaiting processing", "#0ea5e9"),
    ("Processed", "#0f766e"),
]


@router.get("/api/v1/analytics/material-flow")
def material_flow(db: Session = Depends(get_db)):
    # 1. where tracked e-waste currently sits (split/merged parents are consumed: skip them)
    stages = defaultdict(int)
    for b in db.query(Batch).filter(Batch.status.notin_(["split", "merged"])).all():
        transfers = db.query(Transfer).filter_by(batch_id=b.id).order_by(Transfer.dispatched_at).all()
        last = transfers[-1] if transfers else None
        if b.status == "collected":
            stages["At collection centre"] += b.net_mass_g
        elif b.status == "in_transit":
            stages["In transit"] += last.dispatch_mass_g if last else b.net_mass_g
        elif b.status == "received":
            if last and last.receipt_mass_g is not None:
                key = "Disputed receipt" if last.status == "disputed" else "Received, awaiting processing"
                stages[key] += last.receipt_mass_g
            else:
                stages["Received, awaiting processing"] += b.net_mass_g
        elif b.status == "processed":
            stages["Processed"] += sum(r.input_g for r in db.query(ProcessingRun).filter_by(batch_id=b.id))

    # 2. what processing turned it into
    runs = db.query(ProcessingRun).all()
    outputs_g, claimed_g, certified_g = defaultdict(int), defaultdict(int), defaultdict(int)
    for o in db.query(MaterialOutput).all():
        outputs_g[o.material] += o.mass_g
        claimed_g[o.material] += o.allocated_g
    for c in db.query(RecoveryCertificate).all():
        p = json.loads(c.payload)["claim"]
        certified_g[p["material"]] += int(round(p["mass_kg"] * 1000))
    residual = sum(r.residual_g for r in runs)
    loss = sum(r.loss_g for r in runs)
    unexplained = sum(max(r.variance_g, 0) for r in runs)
    wip = sum(max(r.wip_change_g, 0) for r in runs)

    nodes, links = [], []

    def node(name, col, color, note=None):
        nodes.append({"name": name, "col": col, "color": color, "note": note})
        return len(nodes) - 1

    def link(s, t, g):
        if g > 0:
            links.append({"source": s, "target": t, "value": round(g / 1000, 3)})

    root = node("Tracked e-waste", 0, "#0f172a")
    idx = {}
    for name, color in STAGES:
        if stages[name] > 0:
            idx[name] = node(name, 1, color)
            link(root, idx[name], stages[name])
    if "Processed" in idx:
        p = idx["Processed"]
        for m, g in sorted(outputs_g.items()):
            if g > 0:
                cert = min(certified_g[m], claimed_g[m])
                note = (f"{claimed_g[m] / 1000:g} kg claimed · {cert / 1000:g} kg certified"
                        if claimed_g[m] else "not yet claimed")
                link(p, node(f"Recovered {m}", 2, "#10b981", note), g)
        for name, g, color in [("Residual waste", residual, "#94a3b8"), ("Process loss", loss, "#f97316"),
                               ("Unexplained", unexplained, "#dc2626"), ("Work in progress", wip, "#a78bfa")]:
            if g > 0:
                link(p, node(name, 2, color), g)
    processed_g = stages["Processed"]
    recovered_g = sum(outputs_g.values())
    return {
        "nodes": nodes, "links": links,
        "summary": {
            "tracked_kg": sum(stages.values()) / 1000,
            "processed_kg": processed_g / 1000,
            "recovered_kg": recovered_g / 1000,
            "recovery_pct": round(recovered_g * 100 / processed_g, 1) if processed_g else None,
            "unexplained_kg": unexplained / 1000,
            "certified_kg": sum(certified_g.values()) / 1000,
        },
    }