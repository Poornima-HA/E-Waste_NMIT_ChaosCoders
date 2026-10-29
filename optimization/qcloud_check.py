import os
from dotenv import load_dotenv
from qpiai_opt.quantum import QpiAIQuantumAuth

load_dotenv("backend/.env")
QpiAIQuantumAuth.login(api_key=os.environ["QPIAI_QCLOUD_API_KEY"])
print("Key valid:", QpiAIQuantumAuth.verify_api_key())
for r in QpiAIQuantumAuth.list_compute_resources(display=False):
    print(r.get("backend_name"), "|", r.get("device_name"), "|", r.get("usage_rate"))