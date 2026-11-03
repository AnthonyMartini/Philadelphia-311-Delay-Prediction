"""Load, audit, label, and featurize Philadelphia 311 requests.

Run:  python data_prep.py [path/to/311_requests_all.csv]
Writes artifacts/audit.json and artifacts/model_table.pkl

Design rules (see report, Section 3):
  * Every feature must be knowable on the day the request is submitted.
  * Rolling counts use strictly earlier days (no same-day information).
  * The split is by time, never random, so the model is tested on the future.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C

USECOLS = ["objectid", "status", "service_name", "agency_responsible", "service_notice",
           "requested_datetime", "updated_datetime", "expected_datetime", "zipcode",
           "closed_datetime"]
DATE_COLS = ["requested_datetime", "updated_datetime", "expected_datetime", "closed_datetime"]


def load_raw(path):
    df = pd.read_csv(path, usecols=USECOLS, dtype=str)
    for c in DATE_COLS:
        df[c] = pd.to_datetime(df[c], errors="coerce").dt.normalize()
    df["zipcode"] = df["zipcode"].str.extract(r"(\d{5})", expand=False)
    return df


def parse_sla_days(notice):
    """'5 Business Days' -> 5.0; anything unparseable -> NaN."""
    return pd.to_numeric(notice.str.extract(r"(\d+)", expand=False), errors="coerce")


def add_label(df, snapshot):
    """delayed = 1 if closed after the expected date, or still open after it.
    Rows still open whose expected date has not passed are right-censored -> label NaN."""
    closed_late = df["closed_datetime"].notna() & (df["closed_datetime"] > df["expected_datetime"])
    closed_on_time = df["closed_datetime"].notna() & (df["closed_datetime"] <= df["expected_datetime"])
    open_overdue = df["closed_datetime"].isna() & (df["expected_datetime"] < snapshot)
    y = pd.Series(np.nan, index=df.index)
    y[closed_on_time] = 0
    y[closed_late | open_overdue] = 1
    return y


def _prior_window_counts(df, key, days=7):
    """Count requests with the same `key` in the `days` days strictly before each request date."""
    d = df.dropna(subset=[key])
    daily = d.groupby([key, "requested_datetime"]).size().unstack(key, fill_value=0)
    full = pd.date_range(daily.index.min(), daily.index.max(), freq="D")
    daily = daily.reindex(full, fill_value=0)
    prior = daily.rolling(days, min_periods=1).sum().shift(1).fillna(0)
    s = prior.stack()
    s.index.names = ["requested_datetime", key]
    return s.rename(f"prior_{days}d_{key}")


def _service_backlog(df, window=30):
    """Same-service tickets submitted in the previous `window` days that are still open at the
    START of day d. A ticket submitted on day r and closed on day c counts on days
    r+1 ... min(r+window, c). Only past information is used.
    (A cumulative all-time backlog drifted upward every year because of very old tickets that were
    never closed, which made the model fail to transfer to later years.)"""
    d0 = df["requested_datetime"].min()
    n_days = (max(df["requested_datetime"].max(), df["closed_datetime"].max()) - d0).days + window + 3
    services = df["service_name"].astype("category")
    codes, names = services.cat.codes.values, services.cat.categories
    r = (df["requested_datetime"] - d0).dt.days.values
    c = (df["closed_datetime"] - d0).dt.days.fillna(10**7).values.astype(np.int64)
    start = r + 1
    stop = np.minimum(r + window, c) + 1          # exclusive end
    valid = stop > start
    diff = np.zeros((n_days + 1, len(names)), dtype=np.int64)
    np.add.at(diff, (start[valid], codes[valid]), 1)
    np.add.at(diff, (np.minimum(stop[valid], n_days), codes[valid]), -1)
    backlog = pd.DataFrame(diff.cumsum(0)[:n_days], columns=names,
                           index=pd.date_range(d0, periods=n_days, freq="D"))
    s = backlog.stack()
    s.index.names = ["requested_datetime", "service_name"]
    return s.rename("service_backlog")


def audit(df, snapshot):
    sr = df[df["expected_datetime"].notna()]
    sla_days = (sr["expected_datetime"] - sr["requested_datetime"]).dt.days
    return {
        "rows_total": int(len(df)),
        "requested_range": [str(df["requested_datetime"].min().date()), str(df["requested_datetime"].max().date())],
        "snapshot_date": str(snapshot.date()),
        "missing_rate": {c: round(float(df[c].isna().mean()), 4) for c in USECOLS},
        "rows_with_expected_date": int(len(sr)),
        "share_information_requests": round(float((df["service_name"] == "Information Request").mean()), 4),
        "negative_expected_window_rows": int((sla_days < 0).sum()),
        "closed_before_requested_rows": int((df["closed_datetime"] < df["requested_datetime"]).sum()),
        "status_counts": df["status"].value_counts().to_dict(),
        "date_granularity": "day (no time of day in this export)",
    }


def build_table(df):
    snapshot = df["updated_datetime"].max()
    report = audit(df, snapshot)

    # Rolling features are computed on ALL requests (the full history the city would have had).
    df = df.join(_prior_window_counts(df, "service_name"), on=["requested_datetime", "service_name"])
    df = df.join(_prior_window_counts(df, "zipcode"), on=["requested_datetime", "zipcode"])
    df = df.join(_service_backlog(df), on=["requested_datetime", "service_name"])
    df = df.join(_prior_window_counts(df, "service_name", days=30), on=["requested_datetime", "service_name"])
    df = df.rename(columns={"prior_7d_service_name": "prior_7d_service_volume",
                            "prior_7d_zipcode": "prior_7d_zip_volume"})

    # Modeling population: service requests with a promised completion date, in the window.
    m = df[(df["expected_datetime"].notna())
           & (df["service_name"] != "Information Request")
           & (df["requested_datetime"] >= C.WINDOW_START)
           & (df["requested_datetime"] <= C.TEST_END)
           & (df["expected_datetime"] >= df["requested_datetime"])].copy()
    m[C.TARGET] = add_label(m, snapshot)
    censored = int(m[C.TARGET].isna().sum())
    m = m[m[C.TARGET].notna()].copy()
    m[C.TARGET] = m[C.TARGET].astype(int)

    m["sla_business_days"] = parse_sla_days(m["service_notice"])
    m["day_of_week"] = m["requested_datetime"].dt.dayofweek
    m["month"] = m["requested_datetime"].dt.month   # kept for audit tables, not a model feature
    m["backlog_share"] = m["service_backlog"] / (m["prior_30d_service_name"] + 1)
    m["prior_7d_zip_volume"] = m["prior_7d_zip_volume"].fillna(0)
    m["resolution_days"] = (m["closed_datetime"] - m["requested_datetime"]).dt.days

    m["split"] = np.select(
        [m["requested_datetime"] <= C.TRAIN_END, m["requested_datetime"] <= C.VAL_END],
        ["train", "val"], default="test")

    # Rare categories are grouped using TRAINING rows only (no peeking at val/test).
    tr = m[m["split"] == "train"]
    keep_services = set(tr["service_name"].value_counts().loc[lambda s: s >= C.MIN_SERVICE_ROWS].index)
    keep_zips = set(tr["zipcode"].value_counts().head(C.TOP_ZIPS).index)
    m["service_name"] = m["service_name"].where(m["service_name"].isin(keep_services), "Other")
    z = m["zipcode"]
    m["zipcode"] = np.where(z.isna(), "Missing", np.where(z.isin(keep_zips), z, "Other"))

    report.update({
        "model_rows": int(len(m)),
        "censored_rows_dropped": censored,
        "split_rows": m["split"].value_counts().to_dict(),
        "delay_rate_by_split": m.groupby("split")[C.TARGET].mean().round(4).to_dict(),
        "n_service_categories": len(keep_services) + 1,
        "n_zip_categories": len(keep_zips) + 2,
    })
    keep = ["objectid", "month", "requested_datetime", "expected_datetime", "closed_datetime", "status",
            "service_notice", "resolution_days", "service_backlog", "split", C.TARGET] + C.FEATURES
    return m[keep].reset_index(drop=True), report


def main(path=None):
    path = Path(path) if path else C.RAW_CSV
    C.ART_DIR.mkdir(parents=True, exist_ok=True)
    df = load_raw(path)
    table, report = build_table(df)
    table.to_pickle(C.ART_DIR / "model_table.pkl")
    (C.ART_DIR / "audit.json").write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
