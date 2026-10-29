"""Read-only endpoints for the Dispatch Optimizer screen."""
import json
from pathlib import Path
from fastapi import APIRouter

ROOT = Path(__file__).resolve().parents[2]
SCENARIO_PATH = ROOT / "optimization" / "fixtures" / "demo_scenario.json"
EVIDENCE = ROOT / "evidence" / "solver_runs"

router = APIRouter(tags=["optimization"])


@router.get("/api/v1/optimization/scenario")
def scenario():
    return json.loads(SCENARIO_PATH.read_text())


@router.get("/api/v1/optimization/quantum-benchmarks")
def quantum_benchmarks():
    """Summaries of saved QAOA benchmark evidence files (real runs only)."""
    out = []
    for p in sorted(EVIDENCE.glob("qaoa_*.json"), reverse=True):
        try:
            r = json.loads(p.read_text())
            q, insp = r["qaoa"], r["qubo_inspection"]["quantum"]
            out.append({
                "file": p.name, "mode": q["mode"], "device": q["device"],
                "backend": q.get("backend"), "job_ids": q.get("job_ids") or [],
                "qubits": insp["qubits"], "depth": insp["logical_circuit"]["depth"],
                "reps": q["reps"], "shots": q["shots"], "plan": q["plan"],
                "feasible": q["feasible"], "cost_inr": q["total_cost_inr"],
                "guarantee": q["guarantee"],
                "matches_optimum": q["matches_brute_force_optimum"],
                "brute_force_cost_inr": r["brute_force"]["total_cost_inr"],
                "milp_cost_inr": r["qpiai_opt_milp"]["total_cost_inr"],
                "milp_guarantee": r["qpiai_opt_milp"]["guarantee"],
                "wall_time_s": q["wall_time_s"],
                "sub_instance": r["sub_instance"]["batches"],
            })
        except (KeyError, json.JSONDecodeError):
            continue
    return out