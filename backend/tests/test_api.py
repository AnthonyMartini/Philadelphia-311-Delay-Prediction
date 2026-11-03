"""Exercise the HTTP contract against the real committed XGBoost model."""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.ml import config as C  # noqa: E402
from backend.main import Settings, create_app  # noqa: E402
from backend.ml.scoring import read_tickets  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(Settings())) as test_client:
        yield test_client


@pytest.fixture
def ticket():
    return {
        "request_id": "API-TEST-1", "service_name": "Illegal Dumping",
        "agency_responsible": "Streets Department", "zipcode": "19121",
        "sla_business_days": 5, "day_of_week": 0, "prior_7d_service_volume": 43,
        "prior_7d_zip_volume": 120, "backlog_share": 0.6,
    }


def test_openapi(client):
    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    assert set(schema.json()["paths"]) == {
        "/api/v1/predictions", "/api/v1/predictions/batch",
        "/api/v1/tickets", "/api/v1/tickets/{request_id}/prediction",
        "/api/v1/tickets/{request_id}", "/api/v1/tickets/{request_id}/similar",
    }
    assert client.get("/docs").status_code == 200


def test_prediction_and_shap(client, ticket):
    response = client.post("/api/v1/predictions", json=ticket)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["request_id"] == ticket["request_id"]
    assert 0 <= result["delay_probability"] <= 1
    p = result["delay_probability"]
    assert result["risk_band"] == ("High" if p >= 0.65 else "Elevated" if p >= 0.5 else "Standard")
    explanation = result["explanation"]
    assert explanation["units"] == "log_odds"
    assert [c["feature"] for c in explanation["contributions"]] == C.FEATURES
    margin = explanation["base_log_odds"] + sum(c["value"] for c in explanation["contributions"])
    assert np.isclose(margin, explanation["output_log_odds"], atol=1e-5)
    assert np.isclose(1 / (1 + np.exp(-margin)), p, atol=1e-5)


def test_batch_matches_single_and_preserves_order(client, ticket):
    other = {**ticket, "request_id": "API-TEST-2", "backlog_share": 0.1}
    batch = client.post("/api/v1/predictions/batch", json={"tickets": [ticket, other]})
    assert batch.status_code == 200, batch.text
    results = batch.json()["predictions"]
    assert [p["request_id"] for p in results] == [ticket["request_id"], other["request_id"]]
    assert all(p["explanation"] is None for p in results)
    for source, result in zip([ticket, other], results):
        single = client.post("/api/v1/predictions", json={**source, "include_explanation": False}).json()
        assert result["delay_probability"] == single["delay_probability"]


def test_batch_explanation(client, ticket):
    response = client.post("/api/v1/predictions/batch", json={"tickets": [ticket], "include_explanation": True})
    assert response.status_code == 200
    assert len(response.json()["predictions"][0]["explanation"]["contributions"]) == 8


@pytest.mark.parametrize(("field", "value"), [
    ("service_name", None), ("service_name", "  "), ("agency_responsible", "Sanitation"),
    ("zipcode", "99999"), ("zipcode", 19121), ("zipcode", "bad"),
    ("sla_business_days", "five"), ("sla_business_days", "5"), ("sla_business_days", -1),
    ("day_of_week", -1), ("day_of_week", 7), ("day_of_week", True),
    ("prior_7d_service_volume", -1), ("prior_7d_zip_volume", None),
    ("prior_7d_zip_volume", 1.5), ("prior_7d_zip_volume", 2**80),
    ("backlog_share", -0.1), ("backlog_share", 1.1), ("backlog_share", "0.5"),
    ("unexpected", "field"), ("request_id", " "),
])
def test_invalid_inputs_are_422(client, ticket, field, value):
    response = client.post("/api/v1/predictions", json={**ticket, field: value})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"][-1] == field


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_inputs_return_json_error(client, ticket, value):
    payload = json.dumps(ticket).replace('"backlog_share": 0.6', f'"backlog_share": {value}')
    response = client.post("/api/v1/predictions", content=payload, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == "backlog_share"


def test_missing_history_is_rejected(client, ticket):
    del ticket["prior_7d_service_volume"]
    assert client.post("/api/v1/predictions", json=ticket).status_code == 422


def test_normalization_and_intentional_missing_values(client, ticket):
    ticket.update(service_name=" illegal dumping ", agency_responsible="streets department",
                  zipcode=None, sla_business_days=None, prior_7d_zip_volume=0)
    response = client.post("/api/v1/predictions", json=ticket)
    assert response.status_code == 200, response.text
    features = response.json()["features"]
    assert features["service_name"] == "Illegal Dumping"
    assert features["agency_responsible"] == "Streets Department"
    assert features["zipcode"] == "Missing"
    assert features["sla_business_days"] is None
    ticket["zipcode"] = "19121-1234"
    assert client.post("/api/v1/predictions", json=ticket).json()["features"]["zipcode"] == "19121"


def test_missing_zip_requires_training_consistent_volume(client, ticket):
    response = client.post("/api/v1/predictions", json={**ticket, "zipcode": None})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == "prior_7d_zip_volume"


def test_unknown_service_is_explicitly_grouped(client, ticket):
    response = client.post("/api/v1/predictions", json={**ticket, "service_name": "Brand new service"})
    assert response.status_code == 200
    assert response.json()["features"]["service_name"] == "Other"
    assert response.json()["warnings"]


def test_batch_category_error_identifies_row(client, ticket):
    response = client.post("/api/v1/predictions/batch", json={
        "tickets": [ticket, {**ticket, "agency_responsible": "Unsupported department"}]})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "tickets", 1, "agency_responsible"]


@pytest.mark.parametrize("size", [0, 1001])
def test_batch_limits(client, ticket, size):
    assert client.post("/api/v1/predictions/batch", json={"tickets": [ticket] * size}).status_code == 422


def test_saved_tickets_match_best_iteration_predictions(client):
    page = client.get("/api/v1/tickets", params={"limit": 400})
    assert page.status_code == 200, page.text
    assert page.json()["historical"] is True
    assert page.json()["total"] > 400
    tickets = [item["ticket"] for item in page.json()["tickets"]]
    service = client.app.state.service
    agencies = service.model.meta["categories"]["agency_responsible"]
    unsupported = [ticket for ticket in tickets if ticket["agency_responsible"] not in agencies]
    tickets = [ticket for ticket in tickets if ticket["agency_responsible"] in agencies]
    assert len(tickets) > 0
    response = client.post("/api/v1/predictions/batch", json={"tickets": tickets})
    assert response.status_code == 200, response.text
    predictions = np.array([p["delay_probability"] for p in response.json()["predictions"]])
    frame = read_tickets(C.ART_DIR / "reference_tickets.csv").head(400)
    frame = frame[frame["agency_responsible"].isin(agencies)]
    matrix = service.model._dmatrix(frame)
    expected = service.model.booster.predict(matrix, iteration_range=(0, 135))
    full_model = service.model.booster.predict(matrix)
    assert np.allclose(predictions, expected, atol=1e-7)
    assert not np.allclose(expected, full_model, atol=1e-4)
    first = client.get(f"/api/v1/tickets/{tickets[0]['request_id']}/prediction").json()
    assert np.isclose(first["delay_probability"], expected[0], atol=1e-7)
    assert client.get("/api/v1/tickets/does-not-exist/prediction").status_code == 404
    assert client.get("/api/v1/tickets", params={"offset": page.json()["total"]}).json()["tickets"] == []


def test_cors(client):
    headers = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "content-type"}
    response = client.options("/api/v1/predictions", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == headers["Origin"]
    headers["Origin"] = "https://unconfigured.example"
    response = client.options("/api/v1/predictions", headers=headers)
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_missing_model_fails_startup(tmp_path):
    with pytest.raises(FileNotFoundError):
        with TestClient(create_app(Settings(art_dir=tmp_path))):
            pass


def test_metadata_mismatch_fails_startup(tmp_path):
    shutil.copyfile(C.ART_DIR / "xgb_model.json", tmp_path / "xgb_model.json")
    metadata = json.loads((C.ART_DIR / "metadata.json").read_text())
    metadata["features"] = list(reversed(metadata["features"]))
    (tmp_path / "metadata.json").write_text(json.dumps(metadata))
    with pytest.raises(ValueError, match="feature order"):
        with TestClient(create_app(Settings(art_dir=tmp_path))):
            pass


def test_reference_data_is_optional(tmp_path, ticket):
    for name in ("xgb_model.json", "metadata.json"):
        shutil.copyfile(C.ART_DIR / name, tmp_path / name)
    with TestClient(create_app(Settings(art_dir=tmp_path))) as client:
        assert client.post("/api/v1/predictions", json=ticket).status_code == 200
        assert client.get("/api/v1/tickets").status_code == 503


def test_similar_tickets_are_closed_before_intake_and_inspectable(client):
    request_id = "PHL-5430145"
    source = client.get(f"/api/v1/tickets/{request_id}")
    assert source.status_code == 200
    source = source.json()
    response = client.get(f"/api/v1/tickets/{request_id}/similar")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["as_of"] == source["requested_date"]
    assert 0 < len(result["tickets"]) <= 3
    for record in result["tickets"]:
        assert record["closed_date"] < result["as_of"]
        assert record["status"] == "Closed"
        assert record["source"] == "training_reference"
        assert record["ticket"]["service_name"] == source["ticket"]["service_name"]
        inspected = client.get(f"/api/v1/tickets/{record['ticket']['request_id']}")
        assert inspected.status_code == 200
        assert inspected.json()["closed_date"] == record["closed_date"]
    assert client.get("/api/v1/tickets/unknown").status_code == 404
    assert client.get(f"/api/v1/tickets/{request_id}/similar?k=0").status_code == 422


def test_similar_tickets_require_optional_reference_file(tmp_path):
    for name in ("xgb_model.json", "metadata.json"):
        shutil.copyfile(C.ART_DIR / name, tmp_path / name)
    with TestClient(create_app(Settings(art_dir=tmp_path))) as client:
        assert client.get("/api/v1/tickets/PHL-5430145/similar").status_code == 503
