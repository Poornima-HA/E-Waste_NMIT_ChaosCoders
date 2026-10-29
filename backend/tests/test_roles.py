"""Role and custody permissions."""


def H(actor):
    return {"X-Actor": actor}


def _batch(bid, source):
    return {"id": bid, "source_facility_id": source, "category": "IT",
            "mass": {"value": 100, "unit": "kg"}, "operator": "x", "weighed_at": "2026-10-29T10:00:00"}


def test_recycler_cannot_register_batches(client):
    r = client.post("/api/v1/batches", headers=H("ACT-REC"), json=_batch("EW-2098-0001", "F1"))
    assert r.status_code == 403 and "ROLE_NOT_PERMITTED" in r.json()["detail"]


def test_collector_registers_only_at_own_site(client):
    assert client.post("/api/v1/batches", headers=H("ACT-COL"), json=_batch("EW-2098-0002", "CC-A")).status_code == 201
    r = client.post("/api/v1/batches", headers=H("ACT-COL"), json=_batch("EW-2098-0003", "CC-B"))
    assert r.status_code == 403 and "NOT_YOUR_CUSTODY" in r.json()["detail"]


def test_only_custodian_can_dispatch(client, make_batch):
    bid = make_batch(100)                                   # held by CC-A
    r = client.post("/api/v1/transfers", headers=H("ACT-TRN"), json={
        "id": "TR-ROLE-1", "batch_id": bid, "receiver_id": "F1",
        "mass": {"value": 100, "unit": "kg"}, "actor": "x"})
    assert r.status_code == 403 and "NOT_YOUR_CUSTODY" in r.json()["detail"]


def test_only_addressed_party_can_receive(client, make_batch):
    bid = make_batch(100)
    client.post("/api/v1/transfers", json={"id": "TR-ROLE-2", "batch_id": bid, "receiver_id": "F1",
                                           "mass": {"value": 100, "unit": "kg"}, "actor": "x"})
    body = {"receiver_id": "F1", "mass": {"value": 100, "unit": "kg"}, "actor": "x"}
    assert client.post("/api/v1/transfers/TR-ROLE-2/receive", headers=H("ACT-TRN"), json=body).status_code == 403
    assert client.post("/api/v1/transfers/TR-ROLE-2/receive", headers=H("ACT-REC"), json=body).status_code == 200


def test_buyer_cannot_process(client):
    r = client.post("/api/v1/processing-runs", headers=H("ACT-BUY"), json={})
    assert r.status_code == 403 and "ROLE_NOT_PERMITTED" in r.json()["detail"]