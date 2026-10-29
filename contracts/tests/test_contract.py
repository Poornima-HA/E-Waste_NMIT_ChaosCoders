"""EWasteAudit smart-contract security tests + measured gas report.

Runs against a local ganache (127.0.0.1:8545) and deploys its OWN fresh contract
for every test, so the demo contract is never touched.

    .\\backend\\.venv\\Scripts\\python.exe -m pytest contracts\\tests -v --junitxml=evidence\\contract_test_report.xml
"""
import json
from pathlib import Path

import pytest
from solcx import compile_standard, install_solc
from web3 import Web3
from web3.exceptions import ContractLogicError, Web3RPCError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "contracts" / "src" / "EWasteAudit.sol"
RPC = "http://127.0.0.1:8545"
SOLC = "0.8.24"
GAS: dict[str, list[int]] = {}
REVERT = (ContractLogicError, Web3RPCError)


def h(text: str) -> bytes:
    """Deterministic bytes32 test value."""
    return Web3.keccak(text=text)


@pytest.fixture(scope="session")
def w3():
    w = Web3(Web3.HTTPProvider(RPC))
    if not w.is_connected():
        pytest.skip("ganache is not running on 127.0.0.1:8545")
    return w


@pytest.fixture(scope="session")
def compiled():
    install_solc(SOLC)
    out = compile_standard({
        "language": "Solidity",
        "sources": {"EWasteAudit.sol": {"content": SRC.read_text()}},
        "settings": {"optimizer": {"enabled": True, "runs": 200},
                     "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}}},
    }, solc_version=SOLC)
    c = out["contracts"]["EWasteAudit.sol"]["EWasteAudit"]
    return c["abi"], c["evm"]["bytecode"]["object"]


@pytest.fixture
def ctx(w3, compiled):
    abi, bytecode = compiled
    admin, outsider, other = w3.eth.accounts[0], w3.eth.accounts[1], w3.eth.accounts[2]
    tx = w3.eth.contract(abi=abi, bytecode=bytecode).constructor().transact({"from": admin})
    r = w3.eth.wait_for_transaction_receipt(tx)
    GAS.setdefault("deploy", []).append(r.gasUsed)
    return {"w3": w3, "c": w3.eth.contract(address=r.contractAddress, abi=abi),
            "admin": admin, "outsider": outsider, "other": other}


def send(ctx, label, fn, frm=None):
    r = ctx["w3"].eth.wait_for_transaction_receipt(fn.transact({"from": frm or ctx["admin"]}))
    assert r.status == 1
    GAS.setdefault(label, []).append(r.gasUsed)
    return r


def reverts(fn, frm, reason):
    with pytest.raises(REVERT) as e:
        fn.call({"from": frm})
    assert reason in str(e.value), str(e.value)


# ---------------- access control ----------------
def test_deployer_is_admin_and_attestor(ctx):
    c = ctx["c"]
    assert c.functions.admin().call() == ctx["admin"]
    assert c.functions.isAttestor(ctx["admin"]).call() is True
    assert c.functions.isAttestor(ctx["outsider"]).call() is False


def test_outsider_cannot_write_anything(ctx):
    c, o = ctx["c"], ctx["outsider"]
    reverts(c.functions.anchorBatchHead("EW-1", h("a"), 1), o, "not attestor")
    reverts(c.functions.anchorPlan(h("p"), h("s"), "run"), o, "not attestor")
    reverts(c.functions.issueCertificate("RC-1", h("c")), o, "not attestor")
    reverts(c.functions.retireCertificate("RC-1", h("c"), "x"), o, "not attestor")


def test_only_admin_manages_attestors(ctx):
    c = ctx["c"]
    reverts(c.functions.setAttestor(ctx["outsider"], True), ctx["outsider"], "not admin")
    send(ctx, "setAttestor", c.functions.setAttestor(ctx["other"], True))
    send(ctx, "anchorBatchHead", c.functions.anchorBatchHead("EW-2", h("a"), 1), ctx["other"])
    send(ctx, "setAttestor", c.functions.setAttestor(ctx["other"], False))
    reverts(c.functions.anchorBatchHead("EW-2", h("b"), 2), ctx["other"], "not attestor")


# ---------------- batch anchors ----------------
def test_batch_anchor_is_monotonic(ctx):
    c, a = ctx["c"], ctx["admin"]
    send(ctx, "anchorBatchHead", c.functions.anchorBatchHead("EW-3", h("head3"), 3))
    reverts(c.functions.anchorBatchHead("EW-3", h("head3"), 3), a, "stale or replayed")   # replay
    reverts(c.functions.anchorBatchHead("EW-3", h("old"), 2), a, "stale or replayed")     # rollback
    send(ctx, "anchorBatchHead", c.functions.anchorBatchHead("EW-3", h("head4"), 4))
    head, count, _, attestor = c.functions.getBatchAnchor("EW-3").call()
    assert head == h("head4") and count == 4 and attestor == a


def test_empty_hashes_rejected(ctx):
    c, a = ctx["c"], ctx["admin"]
    zero = b"\x00" * 32
    reverts(c.functions.anchorBatchHead("EW-4", zero, 1), a, "empty hash")
    reverts(c.functions.anchorPlan(zero, h("s"), "r"), a, "empty hash")
    reverts(c.functions.issueCertificate("RC-0", zero), a, "empty hash")


def test_batch_anchor_emits_event(ctx):
    c = ctx["c"]
    r = send(ctx, "anchorBatchHead", c.functions.anchorBatchHead("EW-5", h("x"), 1))
    logs = c.events.BatchHeadAnchored().process_receipt(r)
    assert len(logs) == 1 and logs[0]["args"]["batchId"] == "EW-5"


# ---------------- dispatch plans ----------------
def test_plan_anchors_exactly_once(ctx):
    c = ctx["c"]
    send(ctx, "anchorPlan", c.functions.anchorPlan(h("plan"), h("scenario"), "OPT-1"))
    assert c.functions.planAnchoredAt(h("plan")).call() > 0
    reverts(c.functions.anchorPlan(h("plan"), h("scenario"), "OPT-2"), ctx["admin"], "plan already anchored")


# ---------------- certificates ----------------
def test_certificate_issued_exactly_once(ctx):
    c = ctx["c"]
    send(ctx, "issueCertificate", c.functions.issueCertificate("RC-1", h("cert1")))
    reverts(c.functions.issueCertificate("RC-1", h("other")), ctx["admin"], "certificate already issued")
    cert_hash, issued, retired = c.functions.getCertificate("RC-1").call()
    assert cert_hash == h("cert1") and issued > 0 and retired == 0


def test_certificate_single_use(ctx):
    c, a = ctx["c"], ctx["admin"]
    reverts(c.functions.retireCertificate("RC-9", h("x"), "buyer"), a, "certificate not issued")
    send(ctx, "issueCertificate", c.functions.issueCertificate("RC-2", h("cert2")))
    reverts(c.functions.retireCertificate("RC-2", h("forged"), "buyer"), a, "certificate hash mismatch")
    r = send(ctx, "retireCertificate", c.functions.retireCertificate("RC-2", h("cert2"), "buyer"))
    assert len(c.events.CertificateRetired().process_receipt(r)) == 1
    reverts(c.functions.retireCertificate("RC-2", h("cert2"), "buyer-2"), a, "certificate already retired")
    assert c.functions.getCertificate("RC-2").call()[2] > 0


# ---------------- gas report (written after all tests) ----------------
@pytest.fixture(scope="session", autouse=True)
def gas_report():
    yield
    if not GAS:
        return
    avg = {k: round(sum(v) / len(v)) for k, v in GAS.items()}
    lifecycle = 2 * avg.get("anchorBatchHead", 0) + avg.get("issueCertificate", 0) + avg.get("retireCertificate", 0)
    rows = {**avg, "per_batch_lifecycle (2 anchors + issue + retire)": lifecycle}
    prices = [1, 10, 30]          # illustrative gas prices in gwei, NOT live market data
    report = {
        "note": "gasUsed measured on a local EVM (ganache). Cost columns use ILLUSTRATIVE gas prices, "
                "not live market prices: cost_ETH = gas x gwei x 1e-9.",
        "gas_used": rows,
        "illustrative_cost_eth": {f"{p}_gwei": {k: round(v * p * 1e-9, 8) for k, v in rows.items()} for p in prices},
    }
    out = ROOT / "evidence"
    out.mkdir(exist_ok=True)
    (out / "gas_report.json").write_text(json.dumps(report, indent=2))
    md = ["| Operation | Gas used | ETH @1 gwei | ETH @10 gwei | ETH @30 gwei |", "|---|---:|---:|---:|---:|"]
    for k, v in rows.items():
        md.append(f"| {k} | {v:,} | {v * 1e-9:.6f} | {v * 10e-9:.6f} | {v * 30e-9:.6f} |")
    (out / "gas_report.md").write_text("# Measured gas usage\n\n" + report["note"] + "\n\n" + "\n".join(md) + "\n")
    print("\n" + "\n".join(md))