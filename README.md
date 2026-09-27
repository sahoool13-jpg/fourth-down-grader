# 4TH DOWN — Live NFL Decision Grader v0.5.1

A live, outcome-blind NFL fourth-down decision grader with independent `nfl4th` validation.

## Production status

**v0.5.1 is the promoted production candidate.**

The football model was developed on 2021–2024, evaluated separately on 2025, and then passed a paired-bootstrap release audit.

2025 release-audit highlights:

- 3,946 comparable fourth-down states
- exact agreement: 74.58% legacy → 74.94% v0.5.1
- decision-safe rate: 87.35% → 87.56%
- mean reference regret: 0.317 pp → 0.305 pp
- final-five-minute regret: 0.439 pp → 0.336 pp
- final-two-minute regret: 0.522 pp → 0.337 pp
- worst reference regret: 15.24 pp → 8.19 pp
- 17 beneficial flips, 3 harmful, 2 neutral
- release audit verdict: **PROMOTE**

The v0.5.1 football decision logic is frozen. Future model changes belong in v0.6.

## Model architecture

The primary JavaScript engine prices:

- GO
- FIELD GOAL
- PUNT

using game state, conversion probability, field position, score, clock, timeouts, field-goal probability, punt field compression, optional live WP anchoring, sensitivity testing and gated late-game logic.

Inside the final five minutes, v0.5.1 allows score mechanics and possession scarcity to matter, but strong intervention is concentrated in truly terminal states.

## Independent validation

The app uses `nfl4th` as a strong independent reference, not as mathematical ground truth.

Validation layers include:

1. live play-by-play cross-checks
2. multi-season historical calibration
3. 2021–2024 development audit
4. separate 2025 holdout evaluation
5. paired-bootstrap release audit
6. production parity smoke tests

Strong live primary / nfl4th disagreements are shown as `MODEL SPLIT • REVIEW`.

## Production release

Render is configured from `render.yaml` and deploys commits from the connected repository.

After pushing the v0.5.1 production-release metadata, run:

**GitHub → Actions → v0.5.1 production smoke + tag**

Enter:

`PROMOTE-V051`

The workflow waits for Render, verifies the production API against the exact local frozen model, checks the ESPN live adapters, and tags the successful release as `v0.5.1`.

## Local run

Double-click:

`start-windows.bat`

or:

```bash
npm start
```

Then open `http://localhost:3000`.

## Test

```bash
npm test
```

## Important release rule

Do not tune v0.5.1 from the 2025 holdout or from isolated production anecdotes. Preserve it as a fixed benchmark. Any future learning should be evaluated prospectively and developed as v0.6.
