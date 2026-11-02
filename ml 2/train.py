"""Train baselines + XGBoost delay classifier, evaluate on a held-out future period,
and save everything the app needs.

Run after data_prep.py:  python train.py
Outputs (artifacts/): xgb_model.json, logreg.joblib, metadata.json, metrics.json,
                      demo_tickets.pkl, reference_tickets.pkl, figures/*.png
"""
import json
import platform
import time

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
import xgboost as xgb
from sklearn.calibration import calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, f1_score,
                             precision_recall_curve, precision_score, recall_score,
                             roc_auc_score, roc_curve)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

import config as C
from scoring import REQUIRED, to_model_frame

FIG = C.ART_DIR / "figures"


def metrics(y, p, thr):
    yhat = (p >= thr).astype(int)
    return {
        "roc_auc": round(float(roc_auc_score(y, p)), 4) if len(np.unique(y)) > 1 else None,
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 4),
        "precision": round(float(precision_score(y, yhat, zero_division=0)), 4),
        "recall": round(float(recall_score(y, yhat, zero_division=0)), 4),
        "f1": round(float(f1_score(y, yhat, zero_division=0)), 4),
        "flag_rate": round(float(yhat.mean()), 4),
        "precision_top10pct": round(float(np.mean(y[np.argsort(-p)[: max(1, len(p) // 10)]])), 4),
        "delay_rate": round(float(np.mean(y)), 4),
        "n": int(len(y)),
    }


# Operating point: flag a ticket when the model says delay is more likely than not (p >= 0.5).
# We tried picking the F1-maximizing threshold on validation, but with a ~46% delay rate it flagged
# 66-88% of all tickets, which is useless for a review queue. Threshold-free metrics (ROC-AUC, PR-AUC)
# and precision in the top 10% of risk are reported alongside.
THRESHOLD = 0.5


def best_f1_threshold(y, p):
    return THRESHOLD


def logreg_pipeline():
    cats = C.CAT_FEATURES + ["day_of_week"]
    nums = [c for c in C.NUM_FEATURES if c != "day_of_week"]
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=50), cats),
        ("num", Pipeline([("imp", SimpleImputer(strategy="median", add_indicator=True)),
                          ("log", _Log1p()), ("sc", StandardScaler())]), nums),
    ])
    return Pipeline([("pre", pre), ("clf", LogisticRegression(max_iter=2000, C=1.0))])


class _Log1p(sklearn.base.BaseEstimator, sklearn.base.TransformerMixin):
    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return np.log1p(np.clip(X, 0, None))


def fit_xgb(Xtr, ytr, Xva, yva, features):
    model = xgb.XGBClassifier(
        n_estimators=2000, learning_rate=0.05, max_depth=6, min_child_weight=50,
        subsample=0.8, colsample_bytree=0.8, reg_lambda=2.0, max_cat_to_onehot=1,
        tree_method="hist", enable_categorical=True, eval_metric="logloss",
        early_stopping_rounds=50, random_state=C.RANDOM_STATE, n_jobs=-1)
    model.fit(Xtr[features], ytr, eval_set=[(Xva[features], yva)], verbose=False)
    return model


def main():
    t0 = time.time()
    FIG.mkdir(parents=True, exist_ok=True)
    df = pd.read_pickle(C.ART_DIR / "model_table.pkl")
    tr, va, te = (df[df.split == s] for s in ("train", "val", "test"))
    ytr, yva, yte = tr[C.TARGET].values, va[C.TARGET].values, te[C.TARGET].values

    categories = {c: sorted(tr[c].astype(str).unique().tolist()) for c in C.CAT_FEATURES}
    Xtr, Xva, Xte = (to_model_frame(d, categories) for d in (tr, va, te))

    results, thresholds = {}, {}

    # 1) Majority-class baseline
    dummy = DummyClassifier(strategy="most_frequent").fit(Xtr, ytr)
    p_dummy = np.full(len(yte), float(dummy.predict(Xte[:1])[0]))
    results["majority_class"] = metrics(yte, p_dummy, 0.5)

    # 2) Logistic regression baseline
    lr = logreg_pipeline().fit(tr[REQUIRED], ytr)
    thresholds["logistic_regression"] = best_f1_threshold(yva, lr.predict_proba(va[REQUIRED])[:, 1])
    p_lr = lr.predict_proba(te[REQUIRED])[:, 1]
    results["logistic_regression"] = metrics(yte, p_lr, thresholds["logistic_regression"])

    # 3) XGBoost (main model)
    model = fit_xgb(Xtr, ytr, Xva, yva, REQUIRED)
    thresholds["xgboost"] = best_f1_threshold(yva, model.predict_proba(Xva)[:, 1])
    p_xgb = model.predict_proba(Xte)[:, 1]
    results["xgboost"] = metrics(yte, p_xgb, thresholds["xgboost"])

    # 4) Ablation: same model without ZIP code (responsible-AI check)
    no_zip = [f for f in REQUIRED if f != "zipcode"]
    model_nz = fit_xgb(Xtr, ytr, Xva, yva, no_zip)
    thr_nz = best_f1_threshold(yva, model_nz.predict_proba(Xva[no_zip])[:, 1])
    results["xgboost_without_zip"] = metrics(yte, model_nz.predict_proba(Xte[no_zip])[:, 1], thr_nz)

    thr = thresholds["xgboost"]

    # Subgroup check on test: does performance or flag rate differ a lot by department?
    by_agency = {}
    for a, idx in te.groupby("agency_responsible").groups.items():
        if len(idx) >= 2000:
            m = metrics(yte[te.index.get_indexer(idx)], p_xgb[te.index.get_indexer(idx)], thr)
            by_agency[a] = {k: m[k] for k in ("n", "delay_rate", "flag_rate", "roc_auc", "recall", "precision")}

    # Global explanation: mean |SHAP| per feature on a test sample (TreeSHAP via pred_contribs)
    booster = model.get_booster()
    samp = Xte.sample(min(20000, len(Xte)), random_state=C.RANDOM_STATE)
    contribs = booster.predict(xgb.DMatrix(samp, enable_categorical=True), pred_contribs=True)
    shap_abs = pd.Series(np.abs(contribs[:, :-1]).mean(0), index=REQUIRED).sort_values(ascending=False)
    additivity_gap = float(np.max(np.abs(contribs.sum(1) - booster.predict(
        xgb.DMatrix(samp, enable_categorical=True), output_margin=True))))

    # Figures
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
    for name, p in [("Logistic regression", p_lr), ("XGBoost", p_xgb)]:
        fpr, tpr, _ = roc_curve(yte, p)
        ax[0].plot(fpr, tpr, label=f"{name} (AUC {roc_auc_score(yte, p):.3f})")
        pr, rc, _ = precision_recall_curve(yte, p)
        ax[1].plot(rc, pr, label=f"{name} (AP {average_precision_score(yte, p):.3f})")
    ax[0].plot([0, 1], [0, 1], "--", color="grey", lw=1, label="Chance")
    ax[1].axhline(yte.mean(), ls="--", color="grey", lw=1, label="Majority/base rate")
    ax[0].set(xlabel="False positive rate", ylabel="True positive rate", title="ROC, test period")
    ax[1].set(xlabel="Recall", ylabel="Precision", title="Precision-recall, test period")
    for a in ax:
        a.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(FIG / "roc_pr.png", dpi=160); plt.close(fig)

    fig, ax = plt.subplots(figsize=(5, 4.2))
    for name, p in [("Logistic regression", p_lr), ("XGBoost", p_xgb)]:
        fr, mp = calibration_curve(yte, p, n_bins=10, strategy="quantile")
        ax.plot(mp, fr, "o-", label=name)
    ax.plot([0, 1], [0, 1], "--", color="grey", lw=1)
    ax.set(xlabel="Predicted delay probability", ylabel="Observed delay rate", title="Calibration, test period")
    ax.legend(fontsize=8); fig.tight_layout(); fig.savefig(FIG / "calibration.png", dpi=160); plt.close(fig)

    fig, ax = plt.subplots(figsize=(9, 4))
    lab = [C.FEATURE_LABELS[f] for f in shap_abs.index][::-1]
    ax.barh(lab, shap_abs.values[::-1], color="#2f5bea")
    ax.set(xlabel="Mean |SHAP value| (log-odds)", title="Global importance, XGBoost (test sample)")
    fig.tight_layout(); fig.savefig(FIG / "shap_global.png", dpi=160); plt.close(fig)

    # Save model + metadata for the app
    C.ART_DIR.mkdir(exist_ok=True)
    booster.save_model(str(C.ART_DIR / "xgb_model.json"))
    joblib.dump(lr, C.ART_DIR / "logreg.joblib")
    meta = {
        "features": REQUIRED, "categories": categories, "threshold": thr,
        "best_iteration": int(model.best_iteration), "trained_rows": int(len(tr)),
        "train_period": [str(tr.requested_datetime.min().date()), str(tr.requested_datetime.max().date())],
        "val_period": [str(va.requested_datetime.min().date()), str(va.requested_datetime.max().date())],
        "test_period": [str(te.requested_datetime.min().date()), str(te.requested_datetime.max().date())],
        "versions": {"python": platform.python_version(), "xgboost": xgb.__version__,
                     "sklearn": sklearn.__version__, "pandas": pd.__version__},
    }
    (C.ART_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))

    out = {"test_results": results, "thresholds_chosen_on_validation": thresholds,
           "subgroups_by_department_test": by_agency,
           "global_mean_abs_shap": shap_abs.round(4).to_dict(),
           "shap_additivity_max_gap": additivity_gap,
           "train_seconds": round(time.time() - t0, 1), **{k: meta[k] for k in
           ("train_period", "val_period", "test_period", "best_iteration")}}
    (C.ART_DIR / "metrics.json").write_text(json.dumps(out, indent=2))

    # Demo tickets for the app: held-out test tickets only (the model never saw them).
    demo = te.sample(400, random_state=C.RANDOM_STATE).copy()
    demo["request_id"] = "PHL-" + demo["objectid"].astype(str)
    demo.to_csv(C.ART_DIR / "demo_tickets.csv", index=False)
    ref = tr[tr["closed_datetime"].notna()].sample(min(80000, len(tr)), random_state=C.RANDOM_STATE)
    ref.to_csv(C.ART_DIR / "reference_tickets.csv", index=False)

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
