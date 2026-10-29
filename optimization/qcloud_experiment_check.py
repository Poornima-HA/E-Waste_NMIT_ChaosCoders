import os, sys, requests
from dotenv import load_dotenv
from qpiai_opt.quantum import QpiAIQuantumAuth
from qpiai_quantum.jobmanager.jobmanager import JobManager, get_api_url

load_dotenv("backend/.env")
QpiAIQuantumAuth.login(api_key=os.environ["QPIAI_QCLOUD_API_KEY"])
name = sys.argv[1] if len(sys.argv) > 1 else "ewaste-qaoa-benchmark"

jm = JobManager()
try:
    print(f"FOUND '{name}' -> experiment_id = {jm.get_experiment_id_by_name(name)}")
except Exception as e:
    print(f"NOT FOUND '{name}': {e}")

# Best-effort: try to list all experiments visible to this key (read-only)
try:
    r = requests.get(get_api_url("/api/experiments"), headers=jm._get_auth_header(), timeout=30)
    print("List endpoint status:", r.status_code)
    print(r.text[:1500])
except Exception as e:
    print("Could not list experiments:", e)