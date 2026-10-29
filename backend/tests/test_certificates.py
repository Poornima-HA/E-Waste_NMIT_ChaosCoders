"""Recovery certificate lifecycle: issuance, single use, tamper detection."""
from conftest import claim

DOC = [{"name": "weighbridge-slip.pdf", "sha256": "a" * 64, "bytes": 1234}]


def _issue(client, claim_id):
    return client.post("/api/v1/certificates",
                       json={"claim_id": claim_id, "issued_by": "recycler", "documents": DOC})


def test_certificate_is_single_use(client, processed):
    rid, _ = processed()
    cid = f"CL-{rid}-CERT"
    assert claim(client, rid, cid).status_code == 201
    r = _issue(client, cid)
    assert r.status_code == 201, r.text
    cert = r.json()
    v = client.get(f"/api/v1/public/certificates/{cert['id']}").json()
    assert v["db_integrity"] is True and v["verdict"] in ("valid", "unverified")

    body = {"retired_by": "buyer", "purpose": "recycled-content report"}
    assert client.post(f"/api/v1/certificates/{cert['id']}/retire", json=body).status_code == 200
    second = client.post(f"/api/v1/certificates/{cert['id']}/retire", json=body)
    assert second.status_code == 409 and "DOUBLE_USE" in second.json()["detail"]
    assert client.get(f"/api/v1/public/certificates/{cert['id']}").json()["verdict"] == "retired"


def test_one_certificate_per_claim(client, processed):
    rid, _ = processed()
    cid = f"CL-{rid}-ONE"
    assert claim(client, rid, cid).status_code == 201
    assert _issue(client, cid).status_code == 201
    assert _issue(client, cid).status_code == 409


def test_tampered_certificate_detected(client, processed):
    from app.certificates import RecoveryCertificate
    from app.db import SessionLocal

    rid, _ = processed()
    cid = f"CL-{rid}-TAMPER"
    assert claim(client, rid, cid).status_code == 201
    cert_id = _issue(client, cid).json()["id"]
    with SessionLocal() as s:
        c = s.get(RecoveryCertificate, cert_id)
        tampered = c.payload.replace('"mass_kg":80.0', '"mass_kg":800.0')
        assert tampered != c.payload
        c.payload = tampered
        s.commit()
    assert client.get(f"/api/v1/public/certificates/{cert_id}").json()["verdict"] == "tampered"


def test_only_accepted_claims_can_be_certified(client):
    assert _issue(client, "CL-DOES-NOT-EXIST").status_code == 404