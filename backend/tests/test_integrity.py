"""Integrity rules of the E-Waste Ledger, tested end-to-end through the API."""
import json

from sqlalchemy import update

from conftest import claim


# ---------------- custody ----------------
def test_weight_mismatch_preserves_both_readings(client, received_batch):
    bid, tid = received_batch(500, receipt=492)
    b = client.get(f"/api/v1/batches/{bid}").json()
    t = b["transfers"][0]
    assert t["dispatch_kg"] == 500 and t["receipt_kg"] == 492      # nothing overwritten
    assert t["status"] == "disputed"
    assert b["alerts"][0]["rule"] == "RECEIPT_WEIGHT_MISMATCH"
    assert b["alerts"][0]["severity"] == "warning"                  # 1.6%: >0.5% tol, <2% critical


def test_duplicate_receipt_blocked(client, received_batch):
    _, tid = received_batch(300)
    r = client.post(f"/api/v1/transfers/{tid}/receive", json={
        "receiver_id": "F1", "mass": {"value": 300, "unit": "kg"}, "actor": "x"})
    assert r.status_code == 409


def test_wrong_receiver_blocked(client, make_batch):
    bid = make_batch(200)
    client.post("/api/v1/transfers", json={"id": "TR-WRONG1", "batch_id": bid, "receiver_id": "F1",
                                           "mass": {"value": 200, "unit": "kg"}, "actor": "x"})
    r = client.post("/api/v1/transfers/TR-WRONG1/receive", json={
        "receiver_id": "F2", "mass": {"value": 200, "unit": "kg"}, "actor": "x"})
    assert r.status_code == 403


def test_expired_licence_dispatch_blocked(client, make_batch):
    bid = make_batch(200)
    r = client.post("/api/v1/transfers", json={"id": "TR-F3BLK", "batch_id": bid, "receiver_id": "F3",
                                               "mass": {"value": 200, "unit": "kg"}, "actor": "x"})
    assert r.status_code == 422 and "licence" in r.json()["detail"]


def test_unauthorised_category_blocked(client, make_batch):
    bid = make_batch(200, category="TELECOM")
    r = client.post("/api/v1/transfers", json={"id": "TR-CATBLK", "batch_id": bid, "receiver_id": "F2",
                                               "mass": {"value": 200, "unit": "kg"}, "actor": "x"})
    assert r.status_code == 422 and "TELECOM" in r.json()["detail"]


def test_duplicate_batch_id_blocked(client, make_batch):
    bid = make_batch(100)
    r = client.post("/api/v1/batches", json={
        "id": bid, "source_facility_id": "CC-A", "category": "IT",
        "mass": {"value": 100, "unit": "kg"}, "operator": "x", "weighed_at": "2026-10-28T10:00:00"})
    assert r.status_code == 409


# ---------------- hash chain ----------------
def test_hash_chain_detects_tampering(client, make_batch):
    from app.db import SessionLocal
    from app.models import AuditEvent

    bid = make_batch(500)
    assert client.get(f"/api/v1/batches/{bid}/verify-chain").json()["valid"] is True
    with SessionLocal() as s:                       # simulate a DB admin editing history
        e = s.query(AuditEvent).filter_by(batch_id=bid).first()
        e.payload = e.payload.replace("500000", "400000")
        s.commit()
    v = client.get(f"/api/v1/batches/{bid}/verify-chain").json()
    assert v["valid"] is False and v["reason"] == "payload tampered"


# ---------------- mass balance ----------------
def test_mass_balance_problem_statement_example(processed):
    _, run = processed()                           # 500 in; 240 recovered, 245 residual, 10 loss
    assert run["variance_kg"] == 5.0
    assert run["variance_pct"] == 1.0
    assert run["yield_pct"] == 48.0
    assert run["balance_status"] == "pass"


def test_unexplained_variance_warning(processed):
    _, run = processed(residual=235)               # 15 kg unexplained = 3%
    assert run["balance_status"] == "warning"


def test_outputs_exceeding_input_is_critical(client, processed):
    _, run = processed(residual=300)               # 550 out of 500 in
    assert run["balance_status"] == "critical"
    rules = {a["rule"] for a in client.get("/api/v1/audits").json()["alerts"] if a["batch_id"] == run["batch_id"]}
    assert "OUTPUTS_EXCEED_INPUT" in rules


# ---------------- Recovery Integrity Gate ----------------
def test_legit_claim_accepted_with_all_checks(client, processed):
    rid, _ = processed()
    r = claim(client, rid, f"CL-{rid}-1")
    assert r.status_code == 201
    assert r.json()["decision"] == "accepted" and len(r.json()["checks"]) == 4


def test_double_claim_of_same_copper_blocked(client, processed):
    rid, _ = processed()
    assert claim(client, rid, f"CL-{rid}-1").status_code == 201
    r = claim(client, rid, f"CL-{rid}-2")          # new ID + new invoice, same 80 kg
    assert r.status_code == 409 and r.json()["rule"] == "OVER_CLAIM"
    run = client.get(f"/api/v1/processing-runs/{rid}").json()
    copper = next(o for o in run["outputs"] if o["material"] == "copper")
    assert copper["allocated_kg"] == 80 and copper["available_kg"] == 0


def test_partial_claims_cannot_exceed_output(client, processed):
    rid, _ = processed()
    assert claim(client, rid, f"CL-{rid}-A", kg=50).status_code == 201
    assert claim(client, rid, f"CL-{rid}-B", kg=30).status_code == 201
    r = claim(client, rid, f"CL-{rid}-C", kg=1)
    assert r.status_code == 409 and r.json()["rule"] == "OVER_CLAIM"


def test_duplicate_claim_id_blocked(client, processed):
    rid, _ = processed()
    cid = f"CL-{rid}-DUP"
    assert claim(client, rid, cid, kg=10).status_code == 201
    r = claim(client, rid, cid, kg=10, evidence="a different invoice")
    assert r.status_code == 409 and r.json()["rule"] == "DUPLICATE_CLAIM_ID"


def test_evidence_reuse_blocked(client, processed):
    rid, _ = processed()
    ev = f"shared invoice {rid}"
    assert claim(client, rid, f"CL-{rid}-E1", kg=10, evidence=ev).status_code == 201
    r = claim(client, rid, f"CL-{rid}-E2", material="aluminium", kg=10, evidence=ev)
    assert r.status_code == 409 and r.json()["rule"] == "EVIDENCE_REUSED"


def test_claim_on_implausible_run_blocked(client, processed):
    rid, _ = processed(residual=300)               # critical mass balance
    r = claim(client, rid, f"CL-{rid}-1", kg=10)
    assert r.status_code == 409 and r.json()["rule"] == "IMPLAUSIBLE_MASS_BALANCE"


def test_every_attempt_is_logged(client, processed):
    rid, _ = processed()
    claim(client, rid, f"CL-{rid}-L1")
    claim(client, rid, f"CL-{rid}-L2")             # rejected
    attempts = [a for a in client.get("/api/v1/claims").json()["attempts"] if a["run_id"] == rid]
    assert {a["decision"] for a in attempts} == {"accepted", "rejected"}


def test_atomic_allocation_blocks_race(processed):
    """Two sessions both SEE 80 kg free; the conditional UPDATE lets only one win."""
    from app.db import SessionLocal
    from app.recovery import MaterialOutput

    rid, _ = processed()
    s1, s2 = SessionLocal(), SessionLocal()
    try:
        o1 = s1.query(MaterialOutput).filter_by(run_id=rid, material="copper").one()
        o2 = s2.query(MaterialOutput).filter_by(run_id=rid, material="copper").one()
        assert o1.mass_g - o1.allocated_g == 80000 and o2.mass_g - o2.allocated_g == 80000

        def grab():
            return (update(MaterialOutput)
                    .where(MaterialOutput.id == o1.id,
                           MaterialOutput.allocated_g + 80000 <= MaterialOutput.mass_g)
                    .values(allocated_g=MaterialOutput.allocated_g + 80000)
                    .execution_options(synchronize_session=False))

        r1 = s1.execute(grab()); s1.commit()
        r2 = s2.execute(grab()); s2.commit()
        assert r1.rowcount == 1 and r2.rowcount == 0
    finally:
        s1.close()
        s2.close()


# ---------------- inventory ----------------
def test_ghost_inventory_detected(client, processed):
    mat = "copper-ghost-test"
    rid, _ = processed(outputs={mat: 80}, residual=410, loss=10)   # balanced run
    assert claim(client, rid, f"CL-{rid}-G", material=mat, kg=80).status_code == 201
    r = client.post("/api/v1/inventory/counts", json={
        "facility_id": "F1", "material": mat, "counted": {"value": 60, "unit": "kg"},
        "counted_by": "auditor", "method": "platform_scale", "evidence_ref": f"count sheet {rid}"})
    row = r.json()["row"]
    assert row["status"] == "critical"
    assert {f["rule"] for f in row["findings"]} == {"STOCK_SHORTFALL", "GHOST_INVENTORY"}


# ---------------- lineage ----------------
def _split(client, bid, parts):
    return client.post(f"/api/v1/batches/{bid}/split", json={
        "children": [{"id": f"{bid}-{chr(65 + i)}", "mass": {"value": kg, "unit": "kg"}}
                     for i, kg in enumerate(parts)],
        "operator": "ops", "reason": "test split"})


def test_split_conserves_mass_and_links_hashes(client, received_batch):
    from app.db import SessionLocal
    from app.models import AuditEvent

    bid, _ = received_batch(400)
    r = _split(client, bid, [250, 150])
    assert r.status_code == 201
    assert client.get(f"/api/v1/batches/{bid}").json()["status"] == "split"
    parent_head = client.get(f"/api/v1/batches/{bid}").json()["events"][-1]["hash"]
    with SessionLocal() as s:
        first = s.query(AuditEvent).filter_by(batch_id=f"{bid}-A").order_by(AuditEvent.id).first()
        payload = json.loads(first.payload)["payload"]
    assert first.event_type == "LINEAGE_CREATED"
    assert payload["parents"][bid]["parent_head_hash"] == parent_head


def test_split_mass_creation_blocked(client, received_batch):
    bid, _ = received_batch(400)
    r = _split(client, bid, [260, 150])
    assert r.status_code == 409 and "MASS_CREATION" in r.json()["detail"]


def test_split_unexplained_loss_blocked(client, received_batch):
    bid, _ = received_batch(400)
    r = _split(client, bid, [200, 150])
    assert r.status_code == 409 and "UNEXPLAINED_SPLIT_LOSS" in r.json()["detail"]


def test_disputed_batch_cannot_be_split(client, received_batch):
    bid, _ = received_batch(500, receipt=492)
    r = _split(client, bid, [246, 246])
    assert r.status_code == 409 and "disputed" in r.json()["detail"]


def test_merge_requires_same_facility(client, make_batch, received_batch):
    at_cc = make_batch(100)
    at_f1, _ = received_batch(100)
    r = client.post("/api/v1/batches/merge", json={
        "id": f"{at_cc}-M", "parent_ids": [at_cc, at_f1], "operator": "ops", "reason": "test"})
    assert r.status_code == 409 and "same facility" in r.json()["detail"]


# ---------------- costs ----------------
def test_cost_per_kg(client, processed):
    _, run = processed()
    bid = run["batch_id"]
    for cat, amt in [("transport", 1500), ("processing", 2400), ("disposal", 600)]:
        r = client.post("/api/v1/costs", json={"batch_id": bid, "category": cat, "amount_inr": amt,
                                               "reference": f"{cat} invoice", "recorded_by": "finance"})
        assert r.status_code == 201
    s = r.json()
    assert s["total_inr"] == 4500
    assert s["cost_per_kg_collected_inr"] == 9.0       # 4500 / 500 kg
    assert s["cost_per_kg_recovered_inr"] == 18.75     # 4500 / 240 kg