"""Batch-to-facility allocation solved with QpiAI Opt (MILP).
Eligibility is a HARD constraint: ineligible pairs get no decision variable."""
import hashlib, json, time
from datetime import date
from qpiai_opt.opt_modeller import Binary, Model
from qpiai_opt.opt_solvers import Client, solve


def canonical_hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":"),
                                     default=str).encode()).hexdigest()

def _dump(obj):
    if obj is None:
        return None
    return obj.model_dump(mode="json") if hasattr(obj, "model_dump") else str(obj)

def _s(v):
    return None if v is None else str(v)

# ---------- eligibility + costs ----------
def ineligibility_reasons(batch, fac, as_of: date) -> list[str]:
    reasons = []
    valid = fac.get("licence_valid_until")
    if not valid or date.fromisoformat(valid) < as_of:
        reasons.append("licence expired or missing")
    if batch["category"] not in fac["processing_inr_per_kg"]:
        reasons.append(f"not authorised for {batch['category']}")
    return reasons

def cost_matrix(scn, as_of: date):
    rate = scn["transport_rate_inr_per_kg_km"]
    costs, excluded = {}, []
    for b in scn["batches"]:
        for f in scn["facilities"]:
            r = ineligibility_reasons(b, f, as_of)
            if r:
                excluded.append({"batch": b["id"], "facility": f["id"], "reasons": r})
                continue
            km = scn["distances_km"][b["source"]][f["id"]]
            per_kg = km * rate + f["processing_inr_per_kg"][b["category"]]
            costs[(b["id"], f["id"])] = round(b["mass_kg"] * per_kg, 2)
    return costs, excluded

# ---------- QpiAI Opt model ----------
def build_model(scn, costs):
    bidx = {b["id"]: i for i, b in enumerate(scn["batches"])}
    fidx = {f["id"]: j for j, f in enumerate(scn["facilities"])}
    names = {k: f"x_{bidx[k[0]]}_{fidx[k[1]]}" for k in costs}
    x = {k: Binary(names[k]) for k in costs}

    model = Model("ewaste_facility_allocation")
    model.minimize(sum(costs[k] * x[k] for k in costs))

    for b in scn["batches"]:
        terms = [x[k] for k in costs if k[0] == b["id"]]
        if not terms:
            raise ValueError(f"{b['id']} has no eligible facility")
        model.add_constraint(sum(terms) == 1, label=f"assign_{bidx[b['id']]}")

    mass = {b["id"]: b["mass_kg"] for b in scn["batches"]}
    for f in scn["facilities"]:
        terms = [mass[k[0]] * x[k] for k in costs if k[1] == f["id"]]
        if terms:
            model.add_constraint(sum(terms) <= f["capacity_kg"], label=f"cap_{fidx[f['id']]}")
    return model, names

def decode(solution: dict, names: dict) -> dict:
    plan = {}
    for (bid, fid), name in names.items():
        if float(solution.get(name, 0)) > 0.5:
            plan.setdefault(bid, []).append(fid)
    return plan

# ---------- independent verification (does NOT trust the solver) ----------
def check_plan(scn, plan, costs):
    violations, total = [], 0.0
    load = {f["id"]: 0.0 for f in scn["facilities"]}
    for b in scn["batches"]:
        fs = plan.get(b["id"], [])
        if len(fs) != 1:
            violations.append(f"{b['id']}: assigned to {len(fs)} facilities (must be exactly 1)")
            continue
        if (b["id"], fs[0]) not in costs:
            violations.append(f"{b['id']} -> {fs[0]}: ineligible facility")
            continue
        load[fs[0]] += b["mass_kg"]
        total += costs[(b["id"], fs[0])]
    for f in scn["facilities"]:
        if load[f["id"]] > f["capacity_kg"] + 1e-9:
            violations.append(f"{f['id']}: load {load[f['id']]} kg > capacity {f['capacity_kg']} kg")
    assigned = sum(1 for b in scn["batches"] if len(plan.get(b["id"], [])) == 1)
    return {"feasible": not violations, "violations": violations,
            "assigned": assigned, "total_batches": len(scn["batches"]),
            "total_cost_inr": round(total, 2), "load_kg": load}

# ---------- baseline: nearest eligible facility with space ----------
def baseline_nearest(scn, costs):
    remaining = {f["id"]: f["capacity_kg"] for f in scn["facilities"]}
    plan = {}
    for b in scn["batches"]:
        options = sorted((f for (bid, f) in costs if bid == b["id"]),
                         key=lambda f: scn["distances_km"][b["source"]][f])
        for f in options:
            if remaining[f] >= b["mass_kg"]:
                plan[b["id"]] = [f]
                remaining[f] -= b["mass_kg"]
                break
    return plan

# ---------- full run with evidence record ----------
def run_allocation(scn, client: Client, mode: str = "local") -> dict:
    as_of = date.fromisoformat(scn["as_of"])
    costs, excluded = cost_matrix(scn, as_of)
    model, names = build_model(scn, costs)

    t0 = time.perf_counter()
    res = solve(model, mode=mode, client=client)
    wall = round(time.perf_counter() - t0, 3)

    opt_plan = decode(res.solution or {}, names)
    opt = check_plan(scn, opt_plan, costs)
    base_plan = baseline_nearest(scn, costs)
    base = check_plan(scn, base_plan, costs)

    improvement = None
    if opt["feasible"] and base["feasible"] and base["total_cost_inr"] > 0:
        improvement = round((base["total_cost_inr"] - opt["total_cost_inr"])
                            / base["total_cost_inr"] * 100, 2)

    info = res.info()
    record = {
        "scenario_name": scn["name"],
        "scenario_hash": canonical_hash(scn),
        "as_of": scn["as_of"],
        "excluded_pairs": excluded,
        "cost_matrix_inr": [{"batch": b, "facility": f, "cost": c}
                            for (b, f), c in costs.items()],
        "solver": {
            "product": "QpiAI Opt",
            "execution_mode": res.execution_mode,
            "problem_class": res.problem_class,
            "objective": res.objective,
            "method": _s(getattr(info, "method", None)),
            "termination": _s(getattr(info, "termination", None)),
            "guarantee": _s(getattr(info, "guarantee", None)),
            "job_id": getattr(res, "job_id", None),
            "problem_id": getattr(res, "problem_id", None),
            "solver_time_s": getattr(res, "solver_time_s", None),
            "wall_time_s": wall,
            "raw_result": _dump(res),
        },
        "optimized": {"plan": opt_plan, **opt},
        "baseline_nearest": {"plan": base_plan, **base},
        "objective_matches_independent_cost": (
            res.objective is not None
            and abs(res.objective - opt["total_cost_inr"]) < 0.01),
        "cost_improvement_pct": improvement,
    }
    record["plan_hash"] = canonical_hash(
        {"scenario_hash": record["scenario_hash"], "plan": opt_plan})
    return record