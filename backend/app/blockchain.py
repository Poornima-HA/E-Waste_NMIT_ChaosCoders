"""Blockchain anchoring + independent verification for the API."""
import hashlib, json, os
from datetime import datetime
from pathlib import Path

from eth_account import Account
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import String, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, Session
from web3 import Web3

from .allocation import canonical_hash
from .db import Base, get_db
from .models import AuditEvent, Batch, OptimizationRun, utcnow

ROOT = Path(__file__).resolve().parents[2]
DEPLOY_PATH = ROOT / "contracts" / "deployment.json"
ABI_PATH = ROOT / "contracts" / "abi" / "EWasteAudit.json"
GENESIS = "0" * 64
NETWORKS = {11155111: "Sepolia testnet", 1337: "LOCAL DEMO CHAIN (ganache), not public"}


class BlockchainReceipt(Base):
    __tablename__ = "blockchain_receipts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_type: Mapped[str]                 # batch_head | plan
    subject_id: Mapped[str]
    anchored_hash: Mapped[str] = mapped_column(String(66))
    event_count: Mapped[int | None]
    chain_id: Mapped[int]
    contract: Mapped[str]
    tx_hash: Mapped[str | None]
    block_number: Mapped[int | None]
    status: Mapped[str] = mapped_column(default="pending")   # pending|confirmed|failed
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


router = APIRouter(tags=["blockchain"])


# ---------- helpers ----------
def chain():
    if not DEPLOY_PATH.exists():
        raise HTTPException(503, "Contract not deployed, run contracts/deploy.py")
    dep = json.loads(DEPLOY_PATH.read_text())
    w3 = Web3(Web3.HTTPProvider(
        os.environ.get("RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
        request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise HTTPException(503, "Blockchain RPC unreachable (is ganache running?)")
    if w3.eth.chain_id != dep["chain_id"]:
        raise HTTPException(503, f"RPC chain {w3.eth.chain_id} != deployment chain {dep['chain_id']}")
    if not w3.eth.get_code(dep["address"]):
        raise HTTPException(503, "No contract at deployed address (chain reset?), redeploy")
    c = w3.eth.contract(address=dep["address"], abi=json.loads(ABI_PATH.read_text()))
    return w3, c, dep


def chain_heads(db: Session, batch_id: str):
    """Recompute the SHA-256 event chain from the DB. Returns (heads, broken_at_event_id)."""
    prev, heads = GENESIS, []
    for e in db.query(AuditEvent).filter_by(batch_id=batch_id).order_by(AuditEvent.id):
        ok = (e.prev_hash == prev and json.loads(e.payload)["prev"] == prev
              and hashlib.sha256(e.payload.encode()).hexdigest() == e.event_hash)
        if not ok:
            return heads, e.id
        heads.append(e.event_hash)
        prev = e.event_hash
    return heads, None


def send_tx(w3, fn, rec: BlockchainReceipt, db: Session):
    try:
        acct = Account.from_key(os.environ["CHAIN_PRIVATE_KEY"])
        tx = fn.build_transaction({"from": acct.address,
                                   "nonce": w3.eth.get_transaction_count(acct.address),
                                   "chainId": w3.eth.chain_id})
        signed = acct.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        h = w3.eth.send_raw_transaction(raw)
        rec.tx_hash = Web3.to_hex(h)
        db.commit()                          # persisted as PENDING with tx hash
        r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
        rec.block_number = r.blockNumber
        return r
    except Exception as e:
        rec.status, rec.note = "failed", str(e)[:500]
        db.commit()
        raise HTTPException(502, f"Blockchain transaction failed: {e}")


def receipt_out(rec: BlockchainReceipt):
    return {"subject": f"{rec.subject_type}:{rec.subject_id}", "status": rec.status,
            "anchored_hash": rec.anchored_hash, "event_count": rec.event_count,
            "network": NETWORKS.get(rec.chain_id, str(rec.chain_id)),
            "contract": rec.contract, "tx_hash": rec.tx_hash,
            "block": rec.block_number, "note": rec.note,
            "explorer": (f"https://sepolia.etherscan.io/tx/{rec.tx_hash}"
                         if rec.chain_id == 11155111 and rec.tx_hash else None)}


# ---------- endpoints ----------
@router.get("/api/v1/blockchain/status")
def status():
    w3, c, dep = chain()
    return {"connected": True, "network": NETWORKS.get(dep["chain_id"], str(dep["chain_id"])),
            "chain_id": dep["chain_id"], "contract": dep["address"],
            "deploy_tx": dep["deploy_tx"], "latest_block": w3.eth.block_number,
            "public": dep["chain_id"] == 11155111}


@router.post("/api/v1/blockchain/batches/{batch_id}/anchor")
def anchor_batch(batch_id: str, db: Session = Depends(get_db)):
    if not db.get(Batch, batch_id):
        raise HTTPException(404, "Batch not found")
    heads, broken = chain_heads(db, batch_id)
    if broken is not None:
        raise HTTPException(409, f"Audit chain broken at event {broken}; refusing to anchor")
    if not heads:
        raise HTTPException(409, "No events to anchor")
    w3, c, dep = chain()
    onchain_count = c.functions.getBatchAnchor(batch_id).call()[1]
    if len(heads) <= onchain_count:
        raise HTTPException(409, f"Already anchored up to event {onchain_count}; nothing new")
    head = heads[-1]
    rec = BlockchainReceipt(subject_type="batch_head", subject_id=batch_id,
                            anchored_hash="0x" + head, event_count=len(heads),
                            chain_id=dep["chain_id"], contract=dep["address"])
    db.add(rec)
    db.commit()
    r = send_tx(w3, c.functions.anchorBatchHead(batch_id, bytes.fromhex(head), len(heads)), rec, db)
    logs = c.events.BatchHeadAnchored().process_receipt(r)
    ok = (r.status == 1 and len(logs) == 1
          and Web3.to_hex(logs[0]["args"]["headHash"]) == "0x" + head)
    rec.status = "confirmed" if ok else "failed"
    if ok:
        events = (db.query(AuditEvent).filter_by(batch_id=batch_id)
                  .order_by(AuditEvent.id).limit(len(heads)).all())
        for e in events:
            e.chain_status = "anchored"
    db.commit()
    return receipt_out(rec)


@router.get("/api/v1/blockchain/batches/{batch_id}/verify")
def verify_batch(batch_id: str, db: Session = Depends(get_db)):
    """Independent check: recompute DB chain, read the anchor from chain, compare."""
    total = db.query(AuditEvent).filter_by(batch_id=batch_id).count()
    heads, broken = chain_heads(db, batch_id)
    w3, c, dep = chain()
    a = c.functions.getBatchAnchor(batch_id).call()
    onchain_hash, count = Web3.to_hex(a[0]), a[1]

    if count == 0:
        state = "not_anchored"
    elif count > len(heads):
        state = "mismatch"          # DB lost or broke events that were anchored
    else:
        state = "verified" if "0x" + heads[count - 1] == onchain_hash else "mismatch"

    rec = (db.query(BlockchainReceipt)
           .filter_by(subject_type="batch_head", subject_id=batch_id, status="confirmed")
           .order_by(BlockchainReceipt.id.desc()).first())
    tx_ok = None
    if rec and rec.tx_hash:
        try:
            r = w3.eth.get_transaction_receipt(rec.tx_hash)
            tx_ok = r.status == 1 and r["to"].lower() == dep["address"].lower()
        except Exception:
            tx_ok = False

    return {"batch_id": batch_id, "status": state,
            "network": NETWORKS.get(dep["chain_id"], str(dep["chain_id"])),
            "onchain_head": onchain_hash if count else None,
            "onchain_event_count": count, "db_event_count": total,
            "unanchored_events": max(total - count, 0),
            "db_chain_broken_at_event": broken,
            "last_receipt": receipt_out(rec) if rec else None,
            "tx_receipt_verified": tx_ok}


@router.post("/api/v1/optimization/runs/{run_id}/approve")
def approve_plan(run_id: str, db: Session = Depends(get_db)):
    run = db.get(OptimizationRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status == "approved":
        raise HTTPException(409, "Plan already approved")
    rec_json = json.loads(run.record)
    if not rec_json["optimized"]["feasible"]:
        raise HTTPException(422, "Refusing to approve an infeasible plan")
    recomputed = canonical_hash({"scenario_hash": rec_json["scenario_hash"],
                                 "plan": rec_json["optimized"]["plan"]})
    if recomputed != run.plan_hash:
        raise HTTPException(409, "Stored plan does not match its hash; possible tampering")

    w3, c, dep = chain()
    plan_b = bytes.fromhex(run.plan_hash)
    rec = BlockchainReceipt(subject_type="plan", subject_id=run.id,
                            anchored_hash="0x" + run.plan_hash,
                            chain_id=dep["chain_id"], contract=dep["address"])
    db.add(rec)
    db.commit()

    if c.functions.planAnchoredAt(plan_b).call() > 0:
        # identical plan (same scenario + same assignment) already on-chain
        rec.status, rec.note = "confirmed", "Identical plan hash was already anchored on-chain"
    else:
        r = send_tx(w3, c.functions.anchorPlan(
            plan_b, bytes.fromhex(rec_json["scenario_hash"]), run.id), rec, db)
        logs = c.events.PlanAnchored().process_receipt(r)
        rec.status = "confirmed" if (r.status == 1 and len(logs) == 1) else "failed"

    if rec.status == "confirmed":
        run.status = "approved"
    db.commit()
    return {"run_id": run.id, "run_status": run.status, "receipt": receipt_out(rec)}