# v0.4 Historical Calibration

This release adds a multi-season audit of the primary fourth-down model against nfl4th.

## Design

Default sample: 2021–2025.

- 2021–2024: development/diagnostic sample.
- 2025: locked holdout season.
- Only real fourth-down GO / FG / PUNT decisions are included.
- No-play penalties, timeouts, and non-decision fourth-down states are excluded.
- nfl4th probabilities are recomputed with `load_4th_pbp(..., fast = FALSE)`.
- The current JavaScript engine receives the same pre-snap state.

## Headline metric: reference regret

Exact action agreement is useful but can exaggerate tiny differences.

The stronger metric is:

`nfl4th WP of nfl4th-optimal action - nfl4th WP of primary-model action`

A disagreement costing <= 0.75 percentage points is treated as decision-safe.
A disagreement costing >= 2.0 percentage points is a strong split.

## Why a holdout season?

Do not tune directly to every season and then celebrate the fit.

The development sample is for diagnosing biases. The latest completed season is held out and reported separately. When model parameters change, the holdout result is the first check for whether the improvement generalizes.

## Outputs

GitHub Actions writes:

- `public/calibration/report.json`
- `public/calibration/splits.json`
- `public/calibration/status.json`

The webpage at `/calibration.html` reads these files directly from GitHub, so future calibration runs do not need a Render redeploy.

## Run manually

GitHub → Actions → `historical calibration` → Run workflow.

Defaults:

- start season: 2021
- end season: 2025
- holdout: 2025

A full exact nfl4th run may take several minutes because probabilities are recomputed rather than copied.
