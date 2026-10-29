"""Read-only pre-demo smoke check against the RUNNING system. Changes no data.

Run with backend (uvicorn), ganache and frontend running:
    .\\.venv\\Scripts\\python.exe scripts\\smoke_check.py
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:8000"
WEB = "http://127.0.0.1:5173"
results = []


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return r.status, r.read()


def j(path):
    return json.loads(get(API + path)[1])


def check(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, f"{type(e).__name__}: {e}"
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ·  {detail}" if detail else ""))


def facilities():
    ids = {f["id"] for f in j("/api/v1/facilities")}
    need = {"GEN-1", "CC-A", "CC-B", "TR-1", "F1", "F2", "F3", "F4"}
    return need <= ids, "" if need <= ids else f"missing {sorted(need - ids)} -> run reset_demo.py"


def batches():
    b = {x["id"]: x for x in j("/api/v1/batches")}
    need = [f"EW-2026-000{i}" for i in range(1, 7)]
    miss = [n for n in need if n not in b]
    if miss:
        return False, f"missing {miss} -> run reset_demo.py"
    s4 = b["EW-2026-0004"]["status"]
    return s4 == "received", "" if s4 == "received" else f"EW-2026-0004 is '{s4}' (already used in a rehearsal) -> run reset_demo.py"


def full_chain():
    t = j("/api/v1/batches/EW-2026-0001")["transfers"]
    path = " -> ".join([t[0]["from"]] + [x["to"] for x in t]) if t else "none"
    return path == "GEN-1 -> CC-A -> TR-1 -> F1", path


def chain_status():
    s = j("/api/v1/blockchain/status")
    return s["connected"], f"{s['network']} · block {s['latest_block']}"


def batch_verified():
    v = j("/api/v1/blockchain/batches/EW-2026-0001/verify")
    return v["status"] == "verified", f"{v['status']} ({v['onchain_event_count']}/{v['db_event_count']} events)"


def certificate():
    v = j("/api/v1/public/certificates/RC-2026-0001")
    return v["verdict"] == "valid", f"verdict '{v['verdict']}'" + ("" if v["verdict"] == "valid" else " -> run reset_demo.py")


def optimizer():
    runs = j("/api/v1/optimization/runs")
    if not runs:
        return False, "no runs"
    r = j(f"/api/v1/optimization/runs/{runs[0]['id']}")
    ok = r["solver"]["guarantee"] == "global_optimum" and r["optimized"]["feasible"]
    return ok, f"{r['solver']['guarantee']}, {r['optimized']['assigned']}/{r['optimized']['total_batches']} placed, {runs[0]['status']}"


def quantum():
    q = j("/api/v1/optimization/quantum-benchmarks")
    return len(q) > 0 and all(x["matches_optimum"] for x in q), f"{len(q)} QAOA runs"


def metrics():
    m = j("/api/v1/metrics")
    t = m["tests"]
    return bool(t) and t["passed"] == t["tests"], f"tests {t['passed']}/{t['tests']}" if t else "no test report"


def flow():
    f = j("/api/v1/analytics/material-flow")
    return len(f["links"]) > 0, f"{f['summary']['tracked_kg']} kg tracked"


def actors():
    a = j("/api/v1/actors")
    return len(a) == 6, ", ".join(x["role_label"] for x in a)


def frontend():
    s, _ = get(WEB)
    return s == 200, WEB


def qcloud_key():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    from qpiai_opt.quantum import QpiAIQuantumAuth
    QpiAIQuantumAuth.login(api_key=os.environ["QPIAI_QCLOUD_API_KEY"])
    return bool(QpiAIQuantumAuth.verify_api_key()), "QCloud key valid + internet OK"


print("E-Waste Ledger pre-demo smoke check (read-only)\n")
check("Backend health", lambda: (j("/health")["status"] == "ok", ""))
check("Facilities incl. company + transporter", facilities)
check("6 participants", actors)
check("Demo batches present + EW-2026-0004 ready", batches)
check("EW-2026-0001 went through the full chain", full_chain)
check("Blockchain reachable", chain_status)
check("EW-2026-0001 verified on-chain", batch_verified)
check("RC-2026-0001 valid and unused", certificate)
check("QpiAI Opt run: global optimum", optimizer)
check("QAOA benchmark evidence", quantum)
check("Test report all green", metrics)
check("Material-flow diagram data", flow)
check("Frontend on port 5173", frontend)
check("QpiAI key + internet (needed for live 'Run QpiAI Opt')", qcloud_key)

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed")
print("READY FOR DEMO ✅" if passed == len(results) else "FIX THE FAILED CHECKS BEFORE DEMOING ❌")
sys.exit(0 if passed == len(results) else 1)