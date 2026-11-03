# 311 Delay Insight — model and dashboard

Predicts whether a Philadelphia 311 service request will miss its promised completion window,
explains each estimate with exact SHAP values, and shows similar closed tickets. Decision support only.

For the HTTP prediction service, see [backend setup and API documentation](../backend/README.md).
It can serve the committed XGBoost artifacts without the raw City export or Streamlit dependencies.

## Setup

```sh
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Put the city export at `data/311_requests_all.csv` (not committed; ~870 MB).

## Run

```sh
python -m ml.data_prep        # audit + label + intake-time features
python -m ml.train             # baselines, XGBoost, metrics, figures
python -m pytest -q ml/tests
python -m streamlit run ml/app.py   # dashboard at http://localhost:8501
```

If `streamlit run` gives "No module named 'streamlit.cli'", an older Anaconda copy is being found first;
`python -m streamlit run app.py` always uses the one installed in this environment.

## Files

| File | Role |
|---|---|
| `config.py` | Dates for the time split, feature list, plain-language feature labels |
| `data_prep.py` | Load, audit, delay label, rolling intake-time features, chronological split |
| `train.py` | Majority-class and logistic-regression baselines, XGBoost, no-ZIP ablation, subgroup check, figures |
| `scoring.py` | Input validation, prediction, per-ticket TreeSHAP, similar-ticket lookup (used by app and tests) |
| `app.py` | Streamlit dashboard: queue → estimate → explanation → similar tickets → simulated review log |
| `tests/` | Pytest validation suite |
| `prompts/` | Prompt design for the planned policy-question feature |

## Label

`delayed = 1` if the request closed after `expected_datetime`, or is still open after it as of the
data snapshot. Open requests not yet due are dropped (right-censored). Information requests and rows
without a promised date are excluded.

## Known limits

* The export has dates only (no time of day), so features use whole prior days.
* `expected_datetime` may be revised after intake for some categories; we use the promised window text
  (`service_notice`) as the feature, but the label still depends on the recorded expected date.
* ZIP code is a strong predictor. It reflects historical service patterns, not causes, and must not be
  used to lower priority for any area.
