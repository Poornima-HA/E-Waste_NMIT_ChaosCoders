from datetime import date
from app.allocation import cost_matrix, check_plan, baseline_nearest

SCN = {
    "as_of": "2026-10-28", "transport_rate_inr_per_kg_km": 0.05,
    "distances_km": {"S": {"F1": 10, "FX": 1}},
    "facilities": [
        {"id": "F1", "capacity_kg": 100, "licence_valid_until": "2027-01-01",
         "processing_inr_per_kg": {"IT": 5}},
        {"id": "FX", "capacity_kg": 999, "licence_valid_until": "2026-01-01",
         "processing_inr_per_kg": {"IT": 1}},
    ],
    "batches": [
        {"id": "B1", "source": "S", "category": "IT", "mass_kg": 80},
        {"id": "B2", "source": "S", "category": "IT", "mass_kg": 50},
    ],
}
AS_OF = date(2026, 10, 28)

def test_expired_facility_has_no_variable():
    costs, excluded = cost_matrix(SCN, AS_OF)
    assert all(f != "FX" for (_, f) in costs)
    assert any(e["facility"] == "FX" for e in excluded)

def test_capacity_violation_detected():
    costs, _ = cost_matrix(SCN, AS_OF)
    r = check_plan(SCN, {"B1": ["F1"], "B2": ["F1"]}, costs)
    assert not r["feasible"] and "capacity" in r["violations"][0]

def test_double_assignment_detected():
    costs, _ = cost_matrix(SCN, AS_OF)
    r = check_plan(SCN, {"B1": ["F1", "F1"]}, costs)
    assert not r["feasible"]

def test_ineligible_assignment_detected():
    costs, _ = cost_matrix(SCN, AS_OF)
    r = check_plan(SCN, {"B1": ["FX"], "B2": ["F1"]}, costs)
    assert any("ineligible" in v for v in r["violations"])

def test_baseline_leaves_batch_unassigned_when_full():
    costs, _ = cost_matrix(SCN, AS_OF)
    plan = baseline_nearest(SCN, costs)
    assert "B1" in plan and "B2" not in plan