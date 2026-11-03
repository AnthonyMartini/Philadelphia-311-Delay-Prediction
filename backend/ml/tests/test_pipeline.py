"""Validation tests: label definition, leakage guards, split order, input validation, explanation units.
Run:  python -m pytest -q tests
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ml import config as C  # noqa: E402
from ml.data_prep import _prior_window_counts, _service_backlog, add_label, parse_sla_days  # noqa: E402
from ml.scoring import to_model_frame  # noqa: E402

D = pd.Timestamp


def test_label_definition_and_censoring():
    df = pd.DataFrame({
        "expected_datetime": [D("2025-01-10")] * 4,
        "closed_datetime": [D("2025-01-10"), D("2025-01-11"), pd.NaT, pd.NaT],
    })
    y = add_label(df, snapshot=D("2025-01-20")).tolist()
    assert y[0] == 0          # closed ON the due date = on time
    assert y[1] == 1          # closed after due date = delayed
    assert y[2] == 1          # still open after due date = delayed
    y_early = add_label(df.iloc[[3]], snapshot=D("2025-01-05"))
    assert np.isnan(y_early.iloc[0])   # open and not yet due = censored, dropped


def test_sla_parsing():
    s = parse_sla_days(pd.Series(["5 Business Days", "1 Business Day", None, "TBD"]))
    assert s.iloc[0] == 5 and s.iloc[1] == 1 and s.iloc[2:].isna().all()


def test_rolling_counts_exclude_same_day():
    df = pd.DataFrame({"service_name": ["A", "A", "A"],
                       "requested_datetime": [D("2025-01-01"), D("2025-01-02"), D("2025-01-02")]})
    s = _prior_window_counts(df, "service_name")
    assert s.loc[(D("2025-01-01"), "A")] == 0     # nothing before day 1
    assert s.loc[(D("2025-01-02"), "A")] == 1     # only day-1 request, not the same-day one


def test_backlog_uses_only_prior_days():
    df = pd.DataFrame({"service_name": ["A", "A", "A"],
                       "requested_datetime": [D("2025-01-01"), D("2025-01-02"), D("2025-01-03")],
                       "closed_datetime": [D("2025-01-02"), pd.NaT, pd.NaT]})
    s = _service_backlog(df)
    assert s.loc[(D("2025-01-02"), "A")] == 1     # day-1 ticket still open at START of day 2
    assert s.loc[(D("2025-01-03"), "A")] == 1     # day-1 closed, day-2 open


def test_no_post_intake_fields_in_features():
    forbidden = {"closed_datetime", "updated_datetime", "status", "status_notes",
                 "resolution_days", "expected_datetime", C.TARGET}
    assert forbidden.isdisjoint(C.FEATURES)


def test_input_validation_and_unseen_category():
    cats = {"service_name": ["Graffiti Removal", "Other"], "agency_responsible": ["Streets Department", "Other"],
            "zipcode": ["19121", "Other", "Missing"]}
    row = {f: 1 for f in C.NUM_FEATURES}
    row.update(service_name="Brand New Category", agency_responsible="Streets Department", zipcode="19121")
    X = to_model_frame(pd.DataFrame([row]), cats)
    assert X["service_name"].iloc[0] == "Other"
    with pytest.raises(ValueError):
        to_model_frame(pd.DataFrame([{"service_name": "x"}]), cats)


ART = C.ART_DIR


@pytest.mark.skipif(not (ART / "model_table.pkl").exists(), reason="run data_prep.py first")
def test_split_is_chronological():
    t = pd.read_pickle(ART / "model_table.pkl")
    g = t.groupby("split")["requested_datetime"]
    assert g.max()["train"] < g.min()["val"] and g.max()["val"] < g.min()["test"]


@pytest.mark.skipif(not (ART / "xgb_model.json").exists(), reason="run train.py first")
def test_shap_contributions_add_up_to_model_output():
    from ml.scoring import DelayModel, read_tickets, sigmoid
    m = DelayModel()
    demo = read_tickets(ART / "demo_tickets.csv").head(100)
    contrib = m.explain(demo)
    p_from_shap = sigmoid(contrib.sum(axis=1).values)
    assert np.allclose(p_from_shap, m.predict_proba(demo), atol=1e-4)
