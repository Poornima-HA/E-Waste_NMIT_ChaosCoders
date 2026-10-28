import json, sys
from web3 import Web3
from solcx import compile_standard, install_solc
from chain import ROOT, ABI_PATH, DEPLOY_PATH, SEPOLIA, connect, account, send

SOLC = "0.8.24"
src = (ROOT / "contracts/src/EWasteAudit.sol").read_text()
print("Installing/locating solc", SOLC, "...")
install_solc(SOLC)
out = compile_standard({
    "language": "Solidity",
    "sources": {"EWasteAudit.sol": {"content": src}},
    "settings": {"optimizer": {"enabled": True, "runs": 200},
                 "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}}},
}, solc_version=SOLC)
c = out["contracts"]["EWasteAudit.sol"]["EWasteAudit"]
abi, bytecode = c["abi"], c["evm"]["bytecode"]["object"]
ABI_PATH.parent.mkdir(parents=True, exist_ok=True)
ABI_PATH.write_text(json.dumps(abi, indent=2))
print("Compiled. ABI saved.")

w3, acct = connect(), account()
bal = w3.eth.get_balance(acct.address)
print(f"Deployer {acct.address} balance: {Web3.from_wei(bal, 'ether')} ETH")
if bal == 0:
    sys.exit("Balance is 0. Fund this address from a Sepolia faucet first.")

r = send(w3, acct, w3.eth.contract(abi=abi, bytecode=bytecode).constructor())
if r.status != 1:
    sys.exit("Deployment transaction failed")

info = {"network": "sepolia" if w3.eth.chain_id == SEPOLIA else str(w3.eth.chain_id),
        "chain_id": w3.eth.chain_id, "address": r.contractAddress,
        "deploy_tx": Web3.to_hex(r.transactionHash), "block": r.blockNumber,
        "deployer": acct.address, "solc": SOLC}
DEPLOY_PATH.write_text(json.dumps(info, indent=2))
print(json.dumps(info, indent=2))
if w3.eth.chain_id == SEPOLIA:
    print("Etherscan:", f"https://sepolia.etherscan.io/address/{r.contractAddress}")