# Prediction API

FastAPI service for the committed Philadelphia 311 XGBoost model. It loads the model once per
worker, accepts prepared intake-time features, and returns delay probabilities, risk bands,
model identity, and optional exact TreeSHAP explanations. It runs independently of Streamlit.

## Start locally

Use Python 3.12 or newer (tested locally on Python 3.14). Run these commands from the repository
root. `python` must resolve to that interpreter when creating the environment; substitute its
full executable path if necessary.

Windows PowerShell:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
& .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Interactive API documentation: <http://127.0.0.1:8000/docs>. Machine-readable contract:
<http://127.0.0.1:8000/openapi.json>.

Only `ml/artifacts/xgb_model.json` and `metadata.json` are required to score supplied inputs.
The saved `demo_tickets.csv` enables the historical ticket list. `reference_tickets.csv` additionally
enables comparable-case lookup and inspection of its source records. Both CSVs are loaded only when
needed. The raw City export,
training table, logistic-regression artifact, charts, and Streamlit are not required by this API.
Missing or incompatible model artifacts stop startup with an error.

## Try a real prediction

The values in `example_request.json` are illustrative prepared features. The response is calculated
by the actual saved model.

```powershell
$body = Get-Content -Raw -LiteralPath 'backend/example_request.json'
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8000/api/v1/predictions' -ContentType 'application/json' -Body $body
```

To score a saved held-out ticket, with its original historical workload features:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/tickets/PHL-5761985/prediction'
```

## Endpoints

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/v1/predictions` | One ticket, with `include_explanation` defaulting to true. |
| POST | `/api/v1/predictions/batch` | `{"tickets": [...], "include_explanation": false}`; 1–1,000 tickets, preserving order. |
| GET | `/api/v1/tickets?limit=100&offset=0` | Paginated historical demo records, including prepared `ticket` payloads. Maximum page size 400. |
| GET | `/api/v1/tickets/{request_id}/prediction` | Score one saved historical ticket; optional `?include_explanation=false`. Unknown IDs return 404. |
| GET | `/api/v1/tickets/{request_id}` | Inspect a held-out or training-reference record by its PHL request ID. |
| GET | `/api/v1/tickets/{request_id}/similar?k=3` | Up to 10 comparable training-reference tickets closed strictly before the target's intake date. |

All input validation errors return HTTP 422 with a `detail` list identifying the offending field.
A batch is validated completely before scoring; a category error includes its ticket index.
The list returns 503 if its demo CSV is absent; similar lookup returns 503 if the reference CSV
is absent. Each record identifies whether it comes from the held-out sample or training references.
Missing record IDs return 404. `/docs` documents all request and response fields.

## Input contract

All eight model feature keys must be present. The API rejects unknown extra fields and numeric
strings, negative counts, non-finite numbers, and out-of-range weekdays/shares.

| Field | Accepted value |
|---|---|
| `service_name` | Nonempty service name. Case and surrounding spaces are normalized. Unrecognized names use the trained `Other` category and produce a warning. |
| `agency_responsible` | A department from the [model's training categories](../artifacts/metadata.json); case and surrounding spaces are normalized. Unknown departments are rejected. |
| `zipcode` | Supported five-digit ZIP, ZIP+4, `"Missing"`, or null. ZIP+4 becomes five digits; null becomes `"Missing"`. Unsupported ZIPs are rejected. |
| `sla_business_days` | Nonnegative integer or null for a genuinely unavailable service notice. |
| `day_of_week` | Integer 0–6, Monday through Sunday, for the submission date. |
| `prior_7d_service_volume` | Nonnegative integer count for the original service category during the seven whole days before intake. |
| `prior_7d_zip_volume` | Nonnegative integer count for the ZIP during those seven days. |
| `backlog_share` | Number between 0 and 1, calculated using the formula below. |
| `request_id` | Optional identifier, up to 128 characters. |

Integer counts and SLA values are limited to 2,147,483,647. A batch ticket contains these fields;
the batch-level `include_explanation` applies to every ticket.

`backlog_share` is the number of same-service requests submitted in the previous 30 days and still
open at the **start of intake day**, divided by the number of same-service submissions in that
window **plus one**. A ticket closed on intake day counts as open at the start of that day.

Workload features must match `data_prep.py`: use all source requests before modeling exclusions,
exclude the submission day, and calculate original-category counts before grouping rare categories.
Training uses zero ZIP volume when ZIP is missing; the API rejects inconsistent missing-ZIP inputs.
A complete, empty history yields zero; unavailable
history is not evidence of zero workload. The API requires callers to supply historical counts and
does not invent them or calculate them from the sampled reference CSV.

There is no connected City feed or raw-ticket-to-history feature builder in this service. It
estimates intake-time risk; replacing the features with today's workload changes that meaning.

## Response contract

Each prediction contains `request_id`, `delay_probability` (0–1), `risk_band`, `threshold`,
`model_version`, UTC `scored_at`, the normalized `features` actually scored, `warnings`, and
`explanation` (null if disabled).

The current threshold is 0.5: Standard is below 0.5, Elevated is 0.5 to below 0.65, and High starts
at 0.65. The model version is a hash of both model and metadata files. `scored_at` is when scoring
ran, not the date represented by the historical inputs.

Explanations contain `base_log_odds`, `output_log_odds`, and one labeled contribution per feature.
The baseline plus contributions equals output log-odds; applying the sigmoid reconstructs the
probability within floating-point tolerance. Contributions are associations, not causes or
percentage-point changes.

The service uses the best 135 trees selected during training, rather than all 185 saved trees.
Shared scoring and future training explanations use the same selection. Existing saved evaluation
figures were not regenerated; the old global SHAP figure was generated using the full booster.

Demo records are historical observations, including already closed cases. The ticket-list response
has `historical: true`; it is not a live operational queue.
One saved record (`PHL-5751262`) has `Office of Information & Technology`, a department absent from
the training categories. Its prediction returns 422 under the same validation rules as new inputs;
the remaining 399 saved records can be scored. The frontend displays the unsupported case for review
and retries valid batch records using the structured validation error indices.

## Frontend integration

The React interface is connected to this API. It loads historical records, batch-scores the queue,
and requests explanations and similar records on demand. Vite proxies `/api` to port 8000 during
development and preview. For a hosted API, set frontend `VITE_API_BASE_URL` and configure the backend's
allowed origins. The service still supports scoring supplied prepared features directly, for example:

```js
const response = await fetch(`${apiBaseUrl}/api/v1/predictions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(preparedTicket),
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result.detail));
const displayPercent = Math.round(result.delay_probability * 100);
// Render result.risk_band and result.explanation.contributions directly.
```

## Configuration and hosting

Set environment variables before starting Uvicorn:

| Variable | Default | Purpose |
|---|---|---|
| `PHL311_ARTIFACT_DIR` | `ml/artifacts`, resolved relative to the model code | Directory containing the model bundle. An explicitly configured relative path resolves from the working directory. |
| `PHL311_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated browser origins allowed to call the API. |
| `PHL311_MODEL_THREADS` | `1` | XGBoost threads per worker, from 1 to 64. |

For example, in PowerShell:

```powershell
$env:PHL311_CORS_ORIGINS = 'http://localhost:5173,https://your-frontend.example'
```

This service needs a Python process on its host. GitHub Pages continues to host only the static
React frontend. Configure the deployed frontend's API URL and add its actual origin above.
Each Uvicorn worker loads its own model. The default command binds to localhost for development.

## Verification

```powershell
& .\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
& .\.venv\Scripts\python.exe -m pytest -q backend/tests ml/tests
```

The tests use the real saved model. They check all 400 demo records, including the unsupported
department case, and verify prediction parity for the 399 supported records. They also cover
single/batch equivalence, SHAP reconstruction, missing/invalid inputs, category normalization, CORS,
startup failures, time-filtered similar records, and source inspection. The training-table chronology
test skips when `model_table.pkl` is absent. `constraints.txt` pins the tested dependency versions.
