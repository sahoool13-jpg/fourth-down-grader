# 4TH DOWN — Live NFL Decision Grader v0.2.2

A live, outcome-blind NFL fourth-down decision grader.

## v0.2.2 possession + field-state integrity fix

- Adds an explicit **Possession** column to every graded fourth down.
- Shows the score from the decision team's perspective at the instant of the choice.
- Shows readable field position and the raw play description for auditability.
- Fixes ESPN `yardLine` semantics: it is offense-relative yards to the opponent goal and must not be flipped based on home/away.
- Uses ESPN pre-snap `start.team`/`start.possession` as the authoritative possession source.
- Reconstructs pre-play scores chronologically so a made FG/TD cannot leak its result into the decision state.
- Reconstructs half timeouts from play-by-play when explicit timeout counts are unavailable.
- Refuses to grade a fourth down when possession or other core pre-snap state cannot be verified.


## v0.2.1 data-integrity hotfix

- Preserves quarter, clock, yards-to-go, field position and raw play text when a completed fourth down is graded.
- Adds readable field-position text to the ledger instead of losing the original ESPN play state.
- Rejects completed decisions with incomplete source fields instead of inventing a grade.
- Treats tiny model differences as TOSS-UP in the UI rather than presenting a false precise winner.
- Adds late-game scoring-possession logic so states such as down 20 in the fourth quarter do not incorrectly prefer a field goal that leaves the offense three scores behind.
- Sorts ESPN win-probability points by sequence before taking the pre-play anchor.
- Adds regression tests for the Packers-Falcons style late-game case and for completed-play metadata.


## What changed in v0.2.2

- Polls **all active NFL games**, not only the game you manually select.
- Keeps completed games on the current decision tape when the feed reports them as final.
- Detects pending fourth downs and produces a live **GO / FG / PUNT** recommendation.
- Detects third downs that are projected to become **two-down territory**.
- Uses ESPN's live pre-play win-probability feed as an optional **baseline anchor** when it is available.
- Applies a counterfactual model to price what would happen after GO success/failure, a made/missed FG, and a punt.
- Adds **sensitivity testing** so tiny model edges can be labelled TOSS-UP instead of being presented as fake precision.
- Produces deterministic explanation drivers for each recommendation.
- Handles common feed edge cases more carefully, including no-play penalties and fake punts/field goals.
- Adds live WPA Burn, decision confidence and A+ through F grading.
- Includes Render deployment configuration and a plain-English online deployment guide.

## Model status

v0.2.2 is substantially stronger than v0.1, but it is still a **research/prototype decision model**, not an official NFL, ESPN, or nfl4th model.

The live engine works in two layers:

1. **Game-state anchor** — when ESPN exposes a current/pre-play win probability, v0.2.2 anchors the model to that real live game state.
2. **Counterfactual pricing** — the engine estimates the change in WP for GO, FG and PUNT using conversion probability, field position, clock, score, timeouts, kick distance and punt field compression.

The model then stress-tests the recommendation by perturbing conversion, kicking and punt assumptions. If reasonable changes flip the preferred choice, the interface downgrades the recommendation to LEAN/TOSS-UP.

This is deliberately outcome-blind. A failed fourth-down attempt can still receive an A+ if GO was the highest-WP decision before the snap.

## Important limitation

The next major model milestone is still historical calibration/backtesting against nflverse play-by-play and nfl4th-style outputs. Do not present v0.2.2 as mathematical ground truth. It is a serious prototype and live decision engine, not a finished commercial-grade model.

## Run on Windows

Double-click:

```text
start-windows.bat
```

The browser opens automatically at:

```text
http://localhost:3000
```

Keep the black command window open while using the app.

## Run from terminal

```bash
npm start
```

Node.js 20+ is required. There are no third-party runtime dependencies.

## Test

```bash
npm test
```

v0.2.2 currently includes automated tests for:

- conversion probability ordering
- field-goal probability ordering
- option ranking
- decision grading
- live WP anchoring
- late trailing possession value
- goal-line aggression
- third-down planning
- ESPN fourth-down parsing
- ESPN win-probability timeline parsing
- fake punt / no-play classification

## Live data adapter

The prototype server uses ESPN's public/undocumented football endpoints for:

- scoreboard data
- game summaries
- play-by-play
- live situation data
- win-probability timeline

The provider is isolated in `lib/espn.js` so it can later be swapped for a licensed data provider without rewriting the analytics engine or UI.

## Architecture

```text
ESPN LIVE DATA
      |
      v
GAME STATE PARSER
      |
      +--> pending 4th down --> counterfactual decision engine
      |
      +--> pending 3rd down --> two-down territory planner
      |
      +--> completed 4th down --> actual decision classifier
                                    |
                                    v
                          GO / FG / PUNT WP
                                    |
                                    v
                          WPA BURN + GRADE
                                    |
                                    v
                           LIVE DECISION TAPE
```

## Put it online

Read `ONLINE-DEPLOY.txt`.

The included `render.yaml` is configured as a Node web service with:

- `npm install`
- `npm start`
- `/api/health` health check
- automatic deploy on commits

## Grade bands

- **A+** — optimal / effectively zero regret
- **A** — <= 0.5 percentage points WPA Burn
- **B** — <= 1.5
- **C** — <= 3.0
- **D** — <= 5.0
- **F** — > 5.0

## Next model milestones

1. Train a historical WP model on nflverse play-by-play rather than relying on the structural fallback when no live anchor exists.
2. Fit fourth-down conversion probability by exact distance, offense, defense, QB and field position.
3. Fit field-goal probability by kicker, exact distance, stadium, roof, wind and temperature.
4. Fit full punt outcome distributions instead of an expected starting field position.
5. Backtest every historical decision and compare recommendations against nfl4th output.
6. Add coach/team season leaderboards with persistent storage.
7. Add weather and roster/injury adjustments.
8. Add automated "Decision of the Week" and "Worst Decision" reports.
