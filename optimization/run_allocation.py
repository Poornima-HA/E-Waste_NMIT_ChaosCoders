import argparse, json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(ROOT / "backend" / ".env")

from qpiai_opt.opt_solvers import Client
from app.allocation import run_allocation

p = argparse.ArgumentParser()
p.add_argument("--mode", choices=["local", "platform"], default="local")
args = p.parse_args()
if args.mode == "platform":
    print("WARNING: platform mode creates a QpiAI job and may consume credits.")

scn = json.loads((ROOT / "optimization/fixtures/demo_scenario.json").read_text())
rec = run_allocation(scn, Client(api_key=os.environ["QPIAI_OPT_API_KEY"]), args.mode)

s, o, b = rec["solver"], rec["optimized"], rec["baseline_nearest"]
print(f"\nQpiAI Opt | mode={s['execution_mode']} class={s['problem_class']} "
      f"termination={s['termination']} guarantee={s['guarantee']} job_id={s['job_id']}")
print(f"Excluded pairs: {len(rec['excluded_pairs'])}")
print(f"\n{'Batch':<14}{'Optimized':<12}{'Baseline':<12}")
for bt in scn["batches"]:
    print(f"{bt['id']:<14}{','.join(o['plan'].get(bt['id'], ['-'])):<12}"
          f"{','.join(b['plan'].get(bt['id'], ['UNASSIGNED'])):<12}")
print(f"\nOptimized : {o['assigned']}/{o['total_batches']} assigned, "
      f"cost INR {o['total_cost_inr']}, violations={o['violations']}")
print(f"Baseline  : {b['assigned']}/{b['total_batches']} assigned, "
      f"cost INR {b['total_cost_inr']}, violations={b['violations']}")
print(f"Objective matches independent cost: {rec['objective_matches_independent_cost']}")
print(f"Cost improvement: {rec['cost_improvement_pct']}  (None = baseline infeasible)")
print(f"Plan hash: {rec['plan_hash']}")

out = ROOT / "evidence/solver_runs" / f"allocation_{args.mode}_{int(time.time())}.json"
out.write_text(json.dumps(rec, indent=2, default=str))
print(f"\nEvidence saved: {out}")