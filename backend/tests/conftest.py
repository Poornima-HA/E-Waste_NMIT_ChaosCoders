"""Test setup: isolated SQLite DB + helpers. Never touches the demo database."""
import itertools
import os
import pathlib
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
TEST_DB = BACKEND / "test_ewaste.db"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"   # set BEFORE importing the app
os.environ["RPC_URL"] = "http://127.0.0.1:9"   # tests never touch the demo blockchain
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app                   # noqa: E402

_batch_ids = itertools.count(1)
_run_ids = itertools.count(9001)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:      # runs lifespan: create tables + seed facilities
        yield c


@pytest.fixture
def make_batch(client):
    def _make(kg=500, category="IT"):
        bid = f"EW-2099-{next(_batch_ids):04d}"
        r = client.post("/api/v1/batches", json={
            "id": bid, "source_facility_id": "CC-A", "category": category,
            "mass": {"value": kg, "unit": "kg"}, "operator": "test-op",
            "weighed_at": "2026-10-28T10:00:00"})
        assert r.status_code == 201, r.text
        return bid
    return _make


@pytest.fixture
def received_batch(client, make_batch):
    def _make(kg=500, receipt=None, to="F1", category="IT"):
        bid = make_batch(kg, category)
        tid = f"TR-T{bid[-4:]}"
        r = client.post("/api/v1/transfers", json={
            "id": tid, "batch_id": bid, "receiver_id": to,
            "mass": {"value": kg, "unit": "kg"}, "actor": "test-op"})
        assert r.status_code == 201, r.text
        r = client.post(f"/api/v1/transfers/{tid}/receive", json={
            "receiver_id": to, "mass": {"value": kg if receipt is None else receipt, "unit": "kg"},
            "actor": f"{to}-gate"})
        assert r.status_code == 200, r.text
        return bid, tid
    return _make


@pytest.fixture
def processed(client, received_batch):
    def _make(outputs=None, residual=245, loss=10, inp=500):
        bid, _ = received_batch(inp)
        rid = f"PR-{next(_run_ids):04d}"
        outputs = outputs or {"copper": 80, "aluminium": 40, "plastics": 120}
        r = client.post("/api/v1/processing-runs", json={
            "id": rid, "batch_id": bid, "facility_id": "F1",
            "input": {"value": inp, "unit": "kg"},
            "outputs": [{"material": m, "mass": {"value": kg, "unit": "kg"}} for m, kg in outputs.items()],
            "residual": {"value": residual, "unit": "kg"},
            "process_loss": {"value": loss, "unit": "kg"},
            "operator": "f1-line", "evidence_ref": f"weighbridge slip {rid}"})
        assert r.status_code == 201, r.text
        return rid, r.json()
    return _make


def claim(client, rid, cid, material="copper", kg=80, evidence=None):
    return client.post("/api/v1/claims", json={
        "claim_id": cid, "run_id": rid, "material": material,
        "mass": {"value": kg, "unit": "kg"}, "claimant": "recycler-alpha",
        "evidence_ref": evidence or f"invoice for {cid}"})