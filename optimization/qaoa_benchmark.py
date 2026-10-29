"""QAOA on QpiAI QCloud vs QpiAI Opt MILP vs brute force, on the SAME
allocation formulation (small real sub-instance)."""
import argparse, itertools, json, os, sys, time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from dotenv import load_dotenv
load_dotenv(ROOT / "backend" / ".env")

from qpiai_opt.opt_modeller import Binary, Model
from qpiai_opt.opt_solvers import Client, solve, inspect
from qpiai_opt.opt_solvers.qubo import QUBOProblem
from qpiai_opt.quantum import QAOA, QpiAIQuantumAuth, QuantumRun
from app.allocation import cost_matrix, check_plan, decode, canonical_hash, _dump

SUB_BATCHES = ["EW-2026-0101", "EW-2026-0104"]
MASS_UNIT_KG = 100        # capacity constraint in 100 kg units (exact for these masses)
COST_SCALE = 1000         # objective scaling for QAOA conditioning; argmin unchanged
MAX_PLATFORM_QUBITS = 12  # safety limit before spending QCloud credits

p = argparse.ArgumentParser()
p.add_argument("--mode", choices=["local", "platform"], default="local")
p.add_argument("--device", default="QpiAI-QSV-Simulator")
p.add_argument("--reps", type=int, default=2)
p.add_argument("--iters", type=int, default=60)
p.add_argument("--shots", type=int, default=2048)
args = p.parse_args()

full = json.loads((ROOT / "optimization/fixtures/demo_scenario.json").read_text())
scn = {**full, "batches": [b for b in full["batches"] if b["id"] in SUB_BATCHES]}
costs, excluded = cost_matrix(scn, date.fromisoformat(scn["as_of"]))
mass = {b["id"]: b["mass_kg"] for b in scn["batches"]}


def build_model():
    bidx = {b["id"]: i for i, b in enumerate(scn["batches"])}
    fidx = {f["id"]: j for j, f in enumerate(scn["facilities"])}
    names = {k: f"x_{bidx[k[0]]}_{fidx[k[1]]}" for k in costs}
    x = {k: Binary(names[k]) for k in costs}
    m = Model("ewaste_allocation_qaoa_subinstance")
    m.minimize(sum((costs[k] / COST_SCALE) * x[k] for k in costs))
    for b in scn["batches"]:
        m.add_constraint(sum(x[k] for k in costs if k[0] == b["id"]) == 1,
                         label=f"assign_{bidx[b['id']]}")
    presolved = []
    for f in scn["facilities"]:
        ks = [k for k in costs if k[1] == f["id"]]
        if not ks:
            continue
        if sum(mass[k[0]] for k in ks) <= f["capacity_kg"]:
            presolved.append(f["id"])          # can never bind: exact removal
            continue
        assert all(mass[k[0]] % MASS_UNIT_KG == 0 for k in ks)
        assert f["capacity_kg"] % MASS_UNIT_KG == 0
        m.add_constraint(
            sum(int(mass[k[0]] // MASS_UNIT_KG) * x[k] for k in ks)
            <= int(f["capacity_kg"] // MASS_UNIT_KG),
            label=f"cap_{fidx[f['id']]}")
    return m, names, presolved


def brute_force():
    options = [[f for (b, f) in costs if b == bt["id"]] for bt in scn["batches"]]
    best = None
    for combo in itertools.product(*options):
        plan = {bt["id"]: [f] for bt, f in zip(scn["batches"], combo)}
        r = check_plan(scn, plan, costs)
        if r["feasible"] and (best is None or r["total_cost_inr"] < best[1]["total_cost_inr"]):
            best = (plan, r)
    return best


model, names, presolved = build_model()

# 1. Ground truth by exhaustive enumeration (independent of every solver)
bf_plan, bf = brute_force()

# 2. QpiAI Opt MILP on the same model
milp = solve(model, client=Client(api_key=os.environ["QPIAI_OPT_API_KEY"]))
milp_plan = decode(milp.solution or {}, names)
milp_chk = check_plan(scn, milp_plan, costs)

# 3. Same model -> QUBO -> QAOA
qubo = QUBOProblem.from_model(model)
report = inspect(qubo, algorithm=QAOA(reps=args.reps))
qubits = report["quantum"]["qubits"]
print(f"QUBO: {qubits} qubits, circuit depth {report['quantum']['logical_circuit']['depth']}, "
      f"presolved (non-binding) capacity: {presolved}")
if args.mode == "platform" and qubits > MAX_PLATFORM_QUBITS:
    sys.exit(f"Refusing platform run: {qubits} qubits > safety limit {MAX_PLATFORM_QUBITS}")
if args.mode == "platform":
    print(f"WARNING: QCloud platform run on {args.device}. Each optimizer iteration "
          f"executes circuits and may consume credits (iters={args.iters}).")

QpiAIQuantumAuth.login(api_key=os.environ["QPIAI_QCLOUD_API_KEY"])
alg = QAOA(reps=args.reps, optimizer="cobyla", max_iterations=args.iters)
run = (QuantumRun(shots=args.shots, seed=7) if args.mode == "local" else
       QuantumRun(shots=args.shots, experiment_name="ewaste-qaoa-benchmark",
                  device_name=args.device))

t0 = time.perf_counter()
q = solve(qubo, mode=args.mode, algorithm=alg, execution=run)
wall = round(time.perf_counter() - t0, 2)

q_plan = decode(q.variable_assignment or {}, names)
q_chk = check_plan(scn, q_plan, costs)
diag = q.quantum
info = q.info()
matches_optimum = q_chk["feasible"] and abs(q_chk["total_cost_inr"] - bf["total_cost_inr"]) < 0.01

record = {
    "experiment": "QAOA vs QpiAI Opt MILP vs brute force (same formulation, sub-instance)",
    "sub_instance": {"batches": SUB_BATCHES, "presolved_facilities": presolved,
                     "mass_unit_kg": MASS_UNIT_KG, "cost_scale": COST_SCALE,
                     "scenario_hash": canonical_hash(scn)},
    "qubo_inspection": report,
    "brute_force": {"plan": bf_plan, **bf},
    "qpiai_opt_milp": {"plan": milp_plan, **milp_chk,
                       "termination": str(getattr(milp.info(), "termination", None)),
                       "guarantee": str(getattr(milp.info(), "guarantee", None))},
    "qaoa": {
        "mode": args.mode, "device": args.device if args.mode == "platform" else "local statevector",
        "backend": getattr(diag, "backend", None),
        "job_ids": getattr(diag, "job_ids", None),
        "reps": args.reps, "max_iterations": args.iters, "shots": args.shots,
        "plan": q_plan, **q_chk,
        "guarantee": str(getattr(info, "guarantee", None)),
        "optimality_proven": getattr(info, "optimality_proven", None),
        "matches_brute_force_optimum": matches_optimum,
        "wall_time_s": wall,
        "diagnostics": _dump(diag),
    },
}

print(f"\nBrute force optimum : {bf_plan}  INR {bf['total_cost_inr']}")
print(f"QpiAI Opt MILP      : {milp_plan}  INR {milp_chk['total_cost_inr']}  "
      f"({record['qpiai_opt_milp']['guarantee']})")
print(f"QAOA [{record['qaoa']['device']}]: {q_plan}  INR {q_chk['total_cost_inr']}  "
      f"feasible={q_chk['feasible']}  guarantee={record['qaoa']['guarantee']}")
print(f"QAOA matches optimum: {matches_optimum}   wall time {wall}s")
print(f"Backend: {record['qaoa']['backend']}   QCloud job IDs: {record['qaoa']['job_ids']}")

tag = "local" if args.mode == "local" else args.device
out = ROOT / "evidence/solver_runs" / f"qaoa_{tag}_{int(time.time())}.json"
out.write_text(json.dumps(record, indent=2, default=str))
print(f"\nEvidence saved: {out}")