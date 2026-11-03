# Philadelphia 311 Delay Insight

A React app recreating the supplied responsive 311 prototype: queue search/filter/sort, ticket explanations, similar-ticket records, policy guidance states, human review, and session-only action logs with JSON export.

The React interface loads historical tickets, delay probabilities, SHAP explanations, and comparable
closed records from the Python prediction API. The saved sample contains 57 requests marked open
and 343 closed requests. One unsupported department produces a visible "No score" result; the other
399 tickets are scored by the trained model. These are historical observations, not a live City queue.
Policy guidance is prewritten, and human-review decisions are simulated and remain in the browser
session. Refresh clears those decisions.

## Run locally

Requires Node.js 22.12+, npm, and Python 3.12+. Start both services from the repository root.
If the project environment has already been created, use it directly.

First terminal (Windows PowerShell):

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
& .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Second terminal:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open the local URL shown by Vite (normally <http://localhost:5173>). Development and preview requests
under `/api` are forwarded to the backend at `127.0.0.1:8000`. The backend must remain running.
For Python setup alternatives and the API contract, see the [backend documentation](backend/README.md).

Build and preview with:

```sh
npm --prefix frontend run build
npm --prefix frontend run preview
```

To connect to a different backend, copy `frontend/.env.example` to `frontend/.env.local`, set `VITE_API_BASE_URL` to
the backend origin, and restart Vite. Leave it empty to use the local proxy. Add the frontend's
origin to the backend's `PHL311_CORS_ORIGINS` when the browser calls the backend directly.

## How the connection works

The interface loads `/api/v1/tickets`, then batch-scores prepared intake features. Validation errors
are attached to the affected records and valid records are retried. Queue filters use the returned
risk bands, and probabilities are rounded only for display. Explanations and similar records load
when their screens open and are cached for the session. "Reload tickets" refreshes records and
clears those caches. Navigation cancels unfinished screen requests.

The similar-ticket route uses only reference outcomes closed before the selected request's intake
date. Source records have their own URLs, so opening or refreshing an inspected reference works.
The interface shows loading, validation, empty, not-found, and connection-error states without
substituting demonstration scores. Review-log exports contain the actual probability, risk band,
model version, scoring timestamp, and features used during review.

## Checks

```sh
npm test
npm run build
```

Backend integration tests:

```powershell
& .\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
& .\.venv\Scripts\python.exe -m pytest -q backend/tests backend/ml/tests
```

## GitHub Pages

1. Push the project, including package-lock.json, to main.
2. In the repository, select **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. The **Deploy to GitHub Pages** workflow publishes on pushes to main. After enabling Pages, you can also run it manually from Actions. Pull requests build without publishing.
4. Find the published URL in the workflow's github-pages environment.

GitHub Pages hosts the frontend only. Host the Python service separately over HTTPS, set the
repository Actions variable `VITE_API_BASE_URL` to that service's origin, and allow the deployed
frontend origin in `PHL311_CORS_ORIGINS`. Rebuild after changing the API URL. The workflow runs the
frontend tests before building. Publishing the frontend alone does not deploy the Python service.

The workflow is `.github/workflows/deploy-pages.yml`. If your default branch changes, update its branch filters and deployment condition. Relative assets support repository Pages URLs and custom domains. Hash navigation supports direct links and refreshes without server rewrites.

[GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

**Team:** Anthony Martini · Riteesh Katta · Jamie Toghranegar
