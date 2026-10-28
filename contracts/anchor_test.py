import json, time, urllib.request
from eth_account import Account
from web3 import Web3
from web3.exceptions import ContractLogicError, Web3RPCError
from chain import ROOT, ABI_PATH, DEPLOY_PATH, SEPOLIA, connect, account, send

BATCH = "EW-2026-0001"
w3, acct = connect(), account()
dep = json.loads(DEPLOY_PATH.read_text())
c = w3.eth.contract(address=dep["address"], abi=json.loads(ABI_PATH.read_text()))
b32 = lambda h: bytes.fromhex(h.removeprefix("0x"))
link = lambda tx: (f"https://sepolia.etherscan.io/tx/{tx}"
                   if w3.eth.chain_id == SEPOLIA else tx)
results = {"contract": dep["address"], "chain_id": w3.eth.chain_id, "checks": []}


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    results["checks"].append({"check": name, "pass": ok, "detail": detail})


def anchor(label, fn, event):
    r = send(w3, acct, fn)
    logs = event().process_receipt(r)
    tx = Web3.to_hex(r.transactionHash)
    ok = (r.status == 1 and r["to"].lower() == dep["address"].lower() and len(logs) == 1)
    check(f"{label} receipt verified", ok, link(tx))
    results.setdefault("txs", []).append({"label": label, "tx": tx, "block": r.blockNumber})


# --- 1. anchor the QpiAI Opt plan hash ---
ev = sorted((ROOT / "evidence/solver_runs").glob("allocation_*.json"))[-1]
rec = json.loads(ev.read_text())
plan = b32(rec["plan_hash"])
if c.functions.planAnchoredAt(plan).call() == 0:
    anchor("anchorPlan", c.functions.anchorPlan(plan, b32(rec["scenario_hash"]), ev.stem),
           c.events.PlanAnchored)
else:
    print("Plan already anchored, skipping")

# --- 2. anchor the batch audit-chain head (backend must be running) ---
vc = json.loads(urllib.request.urlopen(
    f"http://127.0.0.1:8000/api/v1/batches/{BATCH}/verify-chain").read())
assert vc["valid"], "Off-chain chain invalid, refusing to anchor"
if vc["events"] > c.functions.getBatchAnchor(BATCH).call()[1]:
    anchor("anchorBatchHead",
           c.functions.anchorBatchHead(BATCH, b32(vc["head_hash"]), vc["events"]),
           c.events.BatchHeadAnchored)

# --- 3. security tests (eth_call, so no gas spent) ---
try:
    c.functions.anchorBatchHead(BATCH, b32(vc["head_hash"]), vc["events"]).call({"from": acct.address})
    check("replay rejected", False, "replay was ACCEPTED")
except (ContractLogicError, Web3RPCError) as e:
    check("replay rejected", "stale or replayed" in str(e), "revert: stale or replayed anchor")

try:
    c.functions.anchorPlan(b"\x01" * 32, b"\x01" * 32, "x").call({"from": Account.create().address})
    check("unauthorised writer rejected", False, "outsider was ACCEPTED")
except (ContractLogicError, Web3RPCError) as e:
    check("unauthorised writer rejected", "not attestor" in str(e), "revert: not attestor")

# --- 4. read back from chain and compare with database ---
onchain = Web3.to_hex(c.functions.getBatchAnchor(BATCH).call()[0])
check("on-chain head == DB head", onchain == "0x" + vc["head_hash"], onchain)
check("plan anchored on-chain", c.functions.planAnchoredAt(plan).call() > 0)

out = ROOT / "evidence/blockchain_receipts" / f"anchor_test_{int(time.time())}.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(results, indent=2))
print("\nEvidence saved:", out)