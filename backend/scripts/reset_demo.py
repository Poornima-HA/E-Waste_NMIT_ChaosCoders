"""Reset E-Waste Ledger to a clean, known demo dataset.

All data is created THROUGH THE REAL API, so every validation rule,
hash chain, alert and anchor is produced by the actual system.

Usage (from the backend folder, with uvicorn STOPPED):
    .\\.venv\\Scripts\\python.exe scripts\\reset_demo.py
Options:
    --keep-contract    do not redeploy the smart contract
    --skip-optimizer   do not run QpiAI Opt
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND / ".env")

ap = argparse.ArgumentParser()
ap.add_argument("--keep-contract", action="store_true")
ap.add_argument("--skip-optimizer", action="store_true")
args = ap.parse_args()

# ---------- 1. back up + remove the old database ----------
DB = BACKEND / "ewaste.db"
if DB.exists():
    backups = ROOT / "evidence" / "db_backups"
    backups.mkdir(parents=True, exist_ok=True)
    dest = backups / f"ewaste_{int(time.time())}.db"
    shutil.copy2(DB, dest)
    try:
        DB.unlink()
    except PermissionError:
        sys.exit("ewaste.db is in use. Stop uvicorn (Ctrl+C) first, then rerun.")
    print(f"[1/6] Old database backed up to {dest.relative_to(ROOT)}")
else:
    print("[1/6] No existing database")

# ---------- 2. fresh contract (old anchors would clash with new history) ----------
if args.keep_contract:
    print("[2/6] Keeping existing contract")
else:
    print("[2/6] Deploying a fresh audit contract ...")
    r = subprocess.run([sys.executable, str(ROOT / "contracts" / "deploy.py")], cwd=ROOT)
    print("      contract deployed" if r.returncode == 0
          else "      deploy skipped/failed (chain offline?) - continuing without blockchain")

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app                   # noqa: E402

NOW = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def call(c, method, path, body=None):
    r = c.request(method, path, json=body)
    if r.status_code >= 300:
        sys.exit(f"FAILED {method} {path} -> {r.status_code}: {r.text}")
    return r.json()


def batch(c, bid, source, category, kg, operator="op-ravi"):
    call(c, "POST", "/api/v1/batches", {
        "id": bid, "source_facility_id": source, "category": category,
        "mass": {"value": kg, "unit": "kg"}, "operator": operator, "weighed_at": NOW})


def dispatch(c, tid, bid, to, kg):
    call(c, "POST", "/api/v1/transfers", {
        "id": tid, "batch_id": bid, "receiver_id": to,
        "mass": {"value": kg, "unit": "kg"}, "actor": "op-ravi"})


def receive(c, tid, to, kg):
    call(c, "POST", f"/api/v1/transfers/{tid}/receive", {
        "receiver_id": to, "mass": {"value": kg, "unit": "kg"}, "actor": f"{to}-gate"})


def anchor(c, bid):
    r = c.post(f"/api/v1/blockchain/batches/{bid}/anchor")
    print(f"      anchor {bid}: {'confirmed' if r.is_success else 'skipped (' + r.json().get('detail', '')[:60] + ')'}")


with TestClient(app) as c:     # creates tables + seeds facilities
    print("[3/6] Facilities seeded:", ", ".join(f["id"] for f in call(c, "GET", "/api/v1/facilities")))

    # ---------- Scenario A: clean end-to-end ----------
    print("[4/6] Building demo scenarios ...")
    batch(c, "EW-2026-0001", "CC-A", "IT", 500)
    dispatch(c, "TR-0001", "EW-2026-0001", "F1", 500)
    receive(c, "TR-0001", "F1", 500)
    call(c, "POST", "/api/v1/processing-runs", {
        "id": "PR-0001", "batch_id": "EW-2026-0001", "facility_id": "F1",
        "input": {"value": 500, "unit": "kg"},
        "outputs": [{"material": "copper", "mass": {"value": 80, "unit": "kg"}},
                    {"material": "aluminium", "mass": {"value": 40, "unit": "kg"}},
                    {"material": "plastics", "mass": {"value": 120, "unit": "kg"}}],
        "residual": {"value": 245, "unit": "kg"}, "process_loss": {"value": 10, "unit": "kg"},
        "operator": "f1-line-2", "evidence_ref": "Weighbridge slip WB-F1-0042"})
    call(c, "POST", "/api/v1/claims", {
        "claim_id": "CL-COPPER-001", "run_id": "PR-0001", "material": "copper",
        "mass": {"value": 80, "unit": "kg"}, "claimant": "recycler-alpha",
        "evidence_ref": "Buyer invoice INV-7781"})
    for cat, amt, ref in [("transport", 1500, "Transporter invoice TI-221"),
                          ("processing", 2400, "F1 processing invoice PI-088"),
                          ("disposal", 600, "Residual disposal note DN-14")]:
        call(c, "POST", "/api/v1/costs", {"batch_id": "EW-2026-0001", "category": cat,
                                          "amount_inr": amt, "reference": ref, "recorded_by": "finance-desk"})
    call(c, "POST", "/api/v1/inventory/counts", {
        "facility_id": "F1", "material": "copper", "counted": {"value": 80, "unit": "kg"},
        "counted_by": "auditor-meera", "method": "platform_scale", "evidence_ref": "Stock count sheet SC-F1-001"})
    print("      A  EW-2026-0001  clean flow: processed (PASS), copper claimed, costed, reconciled")

    # ---------- Scenario B: missing handover ----------
    batch(c, "EW-2026-0002", "CC-A", "TELECOM", 300)
    dispatch(c, "TR-0002", "EW-2026-0002", "F4", 300)
    print("      B  EW-2026-0002  dispatched to F4, never received (overdue after OVERDUE_HOURS)")

    # ---------- weight mismatch ----------
    batch(c, "EW-2026-0003", "CC-A", "IT", 500)
    dispatch(c, "TR-0003", "EW-2026-0003", "F2", 500)
    receive(c, "TR-0003", "F2", 492)
    print("      M  EW-2026-0003  500 kg sent, 492 kg received at F2 -> disputed")

    # ---------- ready for live processing + fraud demo ----------
    batch(c, "EW-2026-0004", "CC-B", "IT", 500)
    dispatch(c, "TR-0004", "EW-2026-0004", "F1", 500)
    receive(c, "TR-0004", "F1", 500)
    print("      C  EW-2026-0004  500 kg received at F1, ready for LIVE processing")

    # ---------- ready for live merge ----------
    batch(c, "EW-2026-0005", "CC-B", "CONSUMER", 120)
    batch(c, "EW-2026-0006", "CC-B", "CONSUMER", 80)
    print("      L  EW-2026-0005/0006  CONSUMER at CC-B, ready for LIVE merge")

    r = c.post("/api/v1/certificates", json={"claim_id": "CL-COPPER-001",
                                             "issued_by": "recycler-alpha", "documents": []})
    print(f"      certificate for CL-COPPER-001: "
          f"{r.json()['id'] + ' (' + r.json()['chain_status'] + ')' if r.is_success else r.text}")
    # ---------- 5. anchor on-chain ----------
    
    print("[5/6] Anchoring audit chains on-chain ...")
    for bid in ["EW-2026-0001", "EW-2026-0003", "EW-2026-0004"]:
        anchor(c, bid)

    # ---------- 6. QpiAI Opt ----------
    if args.skip_optimizer:
        print("[6/6] Optimizer skipped")
    else:
        print("[6/6] Running QpiAI Opt dispatch allocation ...")
        r = c.post("/api/v1/optimization/solve?mode=local")
        if r.is_success:
            run = r.json()
            print(f"      {run['run_id']}: {run['solver']['termination']} / {run['solver']['guarantee']}, "
                  f"{run['optimized']['assigned']}/{run['optimized']['total_batches']} placed")
            a = c.post(f"/api/v1/optimization/runs/{run['run_id']}/approve")
            print(f"      plan approval + anchor: {'ok' if a.is_success else a.json().get('detail')}")
        else:
            print(f"      skipped: {r.json().get('detail')}")

print("\nDemo dataset ready. Start uvicorn and open http://localhost:5173")