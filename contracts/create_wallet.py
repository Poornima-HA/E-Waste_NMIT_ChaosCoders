import os
from eth_account import Account
from chain import ENV

if os.environ.get("CHAIN_PRIVATE_KEY"):
    print("Wallet already exists:", Account.from_key(os.environ["CHAIN_PRIVATE_KEY"]).address)
else:
    acct = Account.create()
    with open(ENV, "a") as f:
        f.write(f"\nCHAIN_PRIVATE_KEY={acct.key.hex()}\n"
                "RPC_URL=https://ethereum-sepolia-rpc.publicnode.com\n")
    print("New TESTNET-ONLY wallet created. Key saved to backend/.env")
    print("Address (fund this from a Sepolia faucet):", acct.address)