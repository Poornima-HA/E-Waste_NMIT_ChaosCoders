import os, sys
from pathlib import Path
from dotenv import load_dotenv
from web3 import Web3
from eth_account import Account

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "backend" / ".env"
load_dotenv(ENV)
ABI_PATH = ROOT / "contracts" / "abi" / "EWasteAudit.json"
DEPLOY_PATH = ROOT / "contracts" / "deployment.json"
SEPOLIA = 11155111


def connect() -> Web3:
    url = os.environ.get("RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
    w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        sys.exit(f"Cannot reach RPC {url}")
    return w3


def account():
    key = os.environ.get("CHAIN_PRIVATE_KEY")
    if not key:
        sys.exit("CHAIN_PRIVATE_KEY missing in backend/.env, run create_wallet.py first")
    return Account.from_key(key)


def send(w3: Web3, acct, fn):
    tx = fn.build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address),
        "chainId": w3.eth.chain_id,
    })
    signed = acct.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    tx_hash = w3.eth.send_raw_transaction(raw)
    return w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)