# Philadelphia 311 Delay Insight

A React app recreating the supplied responsive 311 prototype: queue search/filter/sort, ticket explanations, similar-ticket records, policy guidance states, human review, and session-only action logs with JSON export.

All records and estimates are provided for demonstration. No model, external AI API, or City ticket integration is connected. Refresh or Reset demo clears decisions.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL shown by Vite. Build and preview with:

```sh
npm run build
npm run preview
```

## GitHub Pages

1. Push the project, including package-lock.json, to main.
2. In the repository, select **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. The **Deploy to GitHub Pages** workflow publishes on pushes to main. After enabling Pages, you can also run it manually from Actions. Pull requests build without publishing.
4. Find the published URL in the workflow's github-pages environment.

The workflow is `.github/workflows/deploy-pages.yml`. If your default branch changes, update its branch filters and deployment condition. Relative assets support repository Pages URLs and custom domains. Hash navigation supports direct links and refreshes without server rewrites.

[GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

**Team:** Anthony Martini · Riteesh Katta · Jamie Toghranegar
