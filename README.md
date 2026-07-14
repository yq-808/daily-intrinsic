# plain-intrinsic

Dated, back-of-the-envelope **intrinsic-value reports** for stocks — one HTML
page per stock, per date, published as a static site via GitHub Pages.

Each report is **valuation only** — no market price. The page ships the DCF
*inputs* and computes the intrinsic value in your browser, so the numbers on the
page are always a live function of the assumptions it carries.

## Layout

```
plain-intrinsic/
├── skills/
│   ├── dcf/                     # DCF (FCFF) valuation skill + engine
│   └── megawatt-pe-valuation/   # Earnings × P/E model for power / AI-infra
├── scripts/
│   └── generate_report.py       # writes a dated report page + rebuilds the index
└── docs/                        # ← GitHub Pages site root (serve from main /docs)
    ├── index.html               # landing page, lists every report by stock & date
    ├── assets/
    │   ├── style.css
    │   └── dcf.js               # client-side DCF engine (port of the dcf skill)
    └── reports/
        ├── manifest.json        # reports + their embedded inputs
        └── googl/2026-07-14.html
```

## Generate a report

```bash
# defaults to today's date
python3 scripts/generate_report.py GOOGL

# or pin the date on the page
python3 scripts/generate_report.py GOOGL --date 2026-07-13
```

The generator does **no** financial math. Each run embeds the symbol's input
JSON into `docs/reports/<symbol>/<date>.html`, records it in
`docs/reports/manifest.json`, and rebuilds `docs/index.html`. The valuation
table and probability-weighted intrinsic value are computed in the browser by
[`docs/assets/dcf.js`](docs/assets/dcf.js) — a faithful port of the `dcf`
skill's engine (`skills/dcf/scripts/dcf_calculator.py`). To post a report for a
new date, run the command again with a new `--date` and commit.

The symbol must have an input file at
`skills/dcf/reference/inputs/<SYMBOL>.json` (GOOGL, MSFT, AAPL are included).
Refreshing the underlying financials uses the skill's own `fetch_*.py` scripts
and requires an API key (`FINNHUB_API_KEY` in a gitignored `.env`).

## Publishing with GitHub Pages

The repo is **public** and GitHub Pages serves from `main` `/docs`, so the live
site is:

**https://yq-808.github.io/plain-intrinsic/**

Pushing to `main` redeploys it automatically.

## Disclaimer

Not investment advice. These are personal modeling exercises — a DCF is only as
good as its assumptions — not recommendations to buy or sell any security.
