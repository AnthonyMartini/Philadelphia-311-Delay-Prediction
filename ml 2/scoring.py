"""Scoring, explanation, and similar-ticket retrieval for one or many tickets.

Shared by train.py, app.py, and tests so the app explains exactly the model that was trained.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

import config as C

REQUIRED = C.FEATURES


def read_tickets(path):
    """Read a saved ticket table (CSV keeps it portable across pandas versions)."""
    df = pd.read_csv(path, dtype={"zipcode": str, "objectid": str},
                     parse_dates=["requested_datetime", "expected_datetime", "closed_datetime"])
    return df


def to_model_frame(df, categories):
    """Validate required fields and cast categoricals to the TRAINING category lists.
    Unseen categories become 'Other' (or NaN if 'Other' was not a training level)."""
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Ticket is missing required fields: {missing}")
    X = df[REQUIRED].copy()
    for c in C.CAT_FEATURES:
        levels = categories[c]
        vals = X[c].astype(str)
        if "Other" in levels:
            vals = vals.where(vals.isin(levels), "Other")
        X[c] = pd.Categorical(vals, categories=levels)
    for c in C.NUM_FEATURES:
        X[c] = pd.to_numeric(X[c], errors="coerce").astype(float)
    return X


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


class DelayModel:
    """Wraps the trained XGBoost booster plus metadata saved by train.py."""

    def __init__(self, art_dir=C.ART_DIR, *, nthread=None):
        import xgboost as xgb
        art_dir = Path(art_dir)
        self.xgb = xgb
        self.meta = json.loads((art_dir / "metadata.json").read_text())
        self.booster = xgb.Booster()
        self.booster.load_model(str(art_dir / "xgb_model.json"))
        self.threshold = self.meta["threshold"]
        if self.meta["features"] != REQUIRED or self.booster.feature_names != REQUIRED:
            raise ValueError("Model, metadata, and configured feature order must match")
        if not 0 <= self.threshold <= 1:
            raise ValueError("Model threshold must be between zero and one")
        best_iteration = self.meta["best_iteration"]
        if not isinstance(best_iteration, int) or not 0 <= best_iteration < self.booster.num_boosted_rounds():
            raise ValueError("Model metadata contains an invalid best_iteration")
        if self.booster.attr("best_iteration") != str(best_iteration):
            raise ValueError("Model and metadata best_iteration must match")
        self.iteration_range = (0, best_iteration + 1)
        if nthread is not None:
            self.booster.set_param({"nthread": nthread})

    def _dmatrix(self, df):
        X = to_model_frame(df, self.meta["categories"])
        return self.xgb.DMatrix(X, enable_categorical=True, nthread=1)

    def predict_proba(self, df):
        return self.booster.predict(self._dmatrix(df), iteration_range=self.iteration_range)

    def explain(self, df):
        """Exact TreeSHAP contributions in log-odds, one column per input feature, plus 'base'.
        Row sums equal the model's output log-odds (checked in tests)."""
        contribs = self.booster.predict(self._dmatrix(df), pred_contribs=True,
                                      iteration_range=self.iteration_range)
        out = pd.DataFrame(contribs, columns=REQUIRED + ["base"], index=df.index)
        return out


def risk_band(p, threshold):
    if p >= max(threshold, 0.0) + 0.15:
        return "High"
    if p >= threshold:
        return "Elevated"
    return "Standard"


def similar_tickets(ticket, reference, k=3):
    """Nearest CLOSED historical tickets of the same service type.
    Distance = standardized differences on intake-time numbers, plus a penalty if the ZIP differs.
    Retrieval is a plain lookup, not an LLM: it shows precedent, it does not change the score."""
    pool = reference[reference["service_name"] == ticket["service_name"]]
    if pool.empty:
        return pool
    cols = ["sla_business_days", "prior_7d_service_volume", "backlog_share", "prior_7d_zip_volume"]
    P = pool[cols].astype(float)
    mu, sd = P.mean(), P.std().replace(0, 1).fillna(1)
    t = pd.Series({c: float(ticket[c]) for c in cols})
    d = (((P - t) / sd) ** 2).sum(axis=1, min_count=1).fillna(99)
    d = d + 2.0 * (pool["zipcode"] != ticket["zipcode"]).astype(float)
    return pool.loc[d.nsmallest(k).index]
