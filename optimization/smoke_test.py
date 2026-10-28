import os, json, time
from dotenv import load_dotenv
from qpiai_opt.opt_modeller import Binary, Model
from qpiai_opt.opt_solvers import Client, solve, inspect
from qpiai_opt.opt_solvers.qubo import QUBOProblem
from qpiai_opt.quantum import QAOA, QpiAIQuantumAuth, QuantumRun

load_dotenv("backend/.env")

# 2 batches -> 2 facilities, cost matrix (₹, demo data)
cost = {("B1","F1"): 400, ("B1","F2"): 650,
        ("B2","F1"): 700, ("B2","F2"): 300}
x = {k: Binary(f"x_{k[0]}_{k[1]}") for k in cost}

model = Model("ewaste_allocation_smoke")
model.minimize(sum(cost[k] * x[k] for k in cost))
for b in ["B1", "B2"]:
    model.add_constraint(x[(b,"F1")] + x[(b,"F2")] == 1, label=f"assign_{b}")

# --- QpiAI Opt (MILP, local, key-verified) ---
client = Client(api_key=os.environ["QPIAI_OPT_API_KEY"])
milp = solve(model, client=client)
print("OPT:", milp.problem_class, milp.execution_mode, milp.solution, milp.objective)

# --- Same model -> QUBO -> QAOA on local simulator (QCloud key) ---
qubo = QUBOProblem.from_model(model)
QpiAIQuantumAuth.login(api_key=os.environ["QPIAI_QCLOUD_API_KEY"])
print("INSPECT:", inspect(qubo, algorithm=QAOA(reps=2)))
q = solve(qubo, algorithm=QAOA(reps=2), execution=QuantumRun(shots=1024, seed=7))
print("QAOA:", q.variable_assignment, q.objective, q.info().guarantee)

os.makedirs("evidence/solver_runs", exist_ok=True)
with open(f"evidence/solver_runs/smoke_{int(time.time())}.json", "w") as f:
    json.dump({"milp": milp.model_dump(mode="json"),
               "qaoa": q.model_dump(mode="json")}, f, indent=2, default=str)